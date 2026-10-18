<script lang="ts">
	import { Plus, Search, X, ArrowRight, Folder, UserRound, Check } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { ensureTag, inferBookmarkKind, type Row } from '#lib/client/workflows.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { cue, foregroundSound } from '#lib/client/sounds.svelte.js';
	import type { Revision } from '#lib/domain/contracts.js';
	type Choice = { kind: 'tag' | 'person' | 'new-tag'; id: string; name: string };
	let {
		library,
		ready,
		tags,
		people,
		collections = [],
		query = $bindable(''),
		personId = null,
		feedback,
		onNormal
	}: {
		library: LibraryClient | null;
		ready: boolean;
		tags: Row[];
		people: Row[];
		collections?: Row[];
		query?: string;
		personId?: string | null;
		feedback: (message: string) => void;
		onNormal: () => void;
	} = $props();
	let mode = $state<'insert' | 'search'>('search');
	let draft = $state(''),
		title = $state(''),
		url = $state(''),
		organizer = $state(''),
		collection = $state(''),
		error = $state(''),
		busy = $state(false);
	let selected = $state<Choice[]>([]),
		completed = $state<string[]>([]),
		captureId = $state(''),
		created = $state(false);
	let input = $state<HTMLInputElement>(),
		titleInput = $state<HTMLInputElement>();
	let restoredScope = $state('');
	const choices = $derived(
		[
			...tags.map((t) => ({ kind: 'tag' as const, id: String(t.id), name: String(t.name) })),
			...people.map((p) => ({
				kind: 'person' as const,
				id: String(p.id),
				name: String(p.displayName)
			}))
		]
			.filter((c) =>
				c.name.toLocaleLowerCase().includes(organizer.replace(/^[#@]/, '').toLocaleLowerCase())
			)
			.slice(0, 12)
	);
	const tagName = $derived(organizer.trim().replace(/^#/, ''));
	const canCreate = $derived(
		!!tagName &&
			!organizer.startsWith('@') &&
			!tags.some((t) => String(t.name).toLocaleLowerCase() === tagName.toLocaleLowerCase())
	);
	const key = (choice: Choice) => `${choice.kind}:${choice.id || choice.name}`;
	function discardDraft() {
		if (busy || created) return;
		draft = '';
		title = '';
		url = '';
		organizer = '';
		collection = '';
		selected = [];
		completed = [];
		captureId = '';
		error = '';
	}
	function toggle(choice: Choice) {
		const id = key(choice);
		selected = selected.some((c) => key(c) === id)
			? selected.filter((c) => key(c) !== id)
			: [...selected, choice];
	}
	// A tab-local draft is scoped to the authenticated vault, including partial-save progress.
	$effect(() => {
		if (!ready || !library?.state.identity) return;
		const scope = `prism:capture:${library.state.identity.vaultId}:${library.state.identity.subject}`;
		if (restoredScope === scope) return;
		restoredScope = scope;
		try {
			const raw = sessionStorage.getItem(scope);
			if (raw) {
				const value = JSON.parse(raw);
				draft = typeof value.draft === 'string' ? value.draft : '';
				title = typeof value.title === 'string' ? value.title : '';
				url = typeof value.url === 'string' ? value.url : '';
				collection = typeof value.collection === 'string' ? value.collection : '';
				selected = Array.isArray(value.selected)
					? value.selected.filter(
							(choice: Choice) =>
								choice &&
								['tag', 'person', 'new-tag'].includes(choice.kind) &&
								typeof choice.id === 'string' &&
								typeof choice.name === 'string'
						)
					: [];
				completed = Array.isArray(value.completed)
					? value.completed.filter((id: unknown): id is string => typeof id === 'string')
					: [];
				captureId = typeof value.captureId === 'string' ? value.captureId : '';
				created = value.created === true;
			}
		} catch {
			/* Keep the in-memory draft. */
		}
	});
	$effect(() => {
		const value = JSON.stringify({
			draft,
			title,
			url,
			collection,
			selected,
			completed,
			captureId,
			created
		});
		if (restoredScope) {
			try {
				sessionStorage.setItem(restoredScope, value);
			} catch {
				/* Storage may be unavailable. */
			}
		}
	});
	onMount(() => {
		const listener = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && mode === 'insert' && url) {
				event.preventDefault();
				void save();
				return;
			}
			if (
				event.defaultPrevented ||
				event.isComposing ||
				document.querySelector(
					'[role="dialog"][aria-modal="true"],[role="alertdialog"],[role="menu"],[role="listbox"]'
				)
			)
				return;
			if ((event.ctrlKey || event.metaKey) && ['k', 'f'].includes(event.key.toLowerCase())) {
				event.preventDefault();
				void switchMode('search');
			} else if (
				event.key === '/' &&
				!(event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')
			) {
				event.preventDefault();
				void switchMode('search');
			} else if (event.key === 'Escape') {
				event.preventDefault();
				mode = 'search';
				onNormal();
			}
		};
		window.addEventListener('keydown', listener);
		return () => window.removeEventListener('keydown', listener);
	});
	export async function focusInsert() {
		await switchMode('insert');
	}
	async function switchMode(next: 'insert' | 'search') {
		mode = next;
		await tick();
		if (next === 'insert' && url) titleInput?.focus();
		else input?.focus();
	}
	function prepare(event: SubmitEvent) {
		event.preventDefault();
		if (mode === 'search' || busy || !ready) return;
		error = '';
		try {
			const value = draft.trim();
			url = normalizeUrl(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`).url;
			captureId = crypto.randomUUID();
			created = false;
			completed = [];
			if (personId && !selected.some((c) => c.kind === 'person' && c.id === personId))
				selected = [
					...selected,
					{
						kind: 'person',
						id: personId,
						name: String(people.find((p) => p.id === personId)?.displayName ?? 'This person')
					}
				];
			void tick().then(() => titleInput?.focus());
		} catch {
			error = 'Enter a valid website link, such as example.com/article.';
			cue('error');
		}
	}
	async function save() {
		if (!library || busy || !ready || !url) return;
		busy = true;
		error = '';
		const stopLoading = foregroundSound();
		try {
			if (!created) {
				const result = await library.save({
					type: 'bookmark.create',
					id: captureId,
					kind: inferBookmarkKind(url),
					title:
						title.trim() ||
						url
							.replace(/^https?:\/\/(www\.)?/, '')
							.replace(/\/$/, '')
							.slice(0, 500),
					url
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not save this link.');
				if (result.status === 'already_exists')
					throw new Error('This link is already in your library. Search for it to edit it.');
				created = true;
			}
			for (const choice of selected) {
				if (completed.includes(key(choice))) continue;
				const result =
					choice.kind === 'person'
						? await library.save({
								type: 'content-person.add',
								bookmarkId: captureId,
								personId: choice.id,
								role: 'related',
								provenance: 'manual'
							})
						: await library.save({
								type: 'tag.add',
								id: captureId,
								tagId: choice.kind === 'new-tag' ? await ensureTag(library, choice.name) : choice.id
							});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Link saved. Retry to finish organizing.');
				completed = [...completed, key(choice)];
			}
			if (collection && !completed.includes(`collection:${collection}`)) {
				const row = library.get<Row>('bookmarks', captureId);
				const result = await library.save({
					type: 'bookmark.organize',
					id: captureId,
					expectedRevision: String(row?.revision ?? '0') as Revision,
					patch: { collectionId: collection }
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Link saved. Retry to finish organizing.');
				completed = [...completed, `collection:${collection}`];
			}
			feedback('Saved on this device.');
			cue('success');
			draft = '';
			title = '';
			url = '';
			organizer = '';
			collection = '';
			selected = [];
			completed = [];
			created = false;
			captureId = '';
		} catch (e) {
			error = (e as Error).message;
			cue('error');
		} finally {
			stopLoading();
			busy = false;
		}
	}
</script>

<section class="omnibar-section" aria-label="Search and save bookmarks">
	<div class="capture-mode-tabs">
		<button class:active={mode === 'search'} onclick={() => switchMode('search')}
			><Search /> Search</button
		><button class:active={mode === 'insert'} onclick={() => switchMode('insert')} data-cuelume-open
			><Plus /> {draft || url ? 'Continue bookmark' : 'Add bookmark'}</button
		>
	</div>
	<form class="omnibar" class:search-mode={mode === 'search'} onsubmit={prepare}>
		{#if mode === 'search'}<Search />{:else}<Plus />{/if}
		<input
			bind:this={input}
			aria-label={mode === 'search' ? 'Search library' : 'Bookmark URL'}
			placeholder={mode === 'search'
				? 'Search titles, notes, #tags, people…'
				: 'Paste a link worth keeping…'}
			value={mode === 'search' ? query : draft}
			oninput={(e) => {
				if (mode === 'search') query = e.currentTarget.value;
				else draft = e.currentTarget.value;
			}}
			disabled={!ready || (mode === 'insert' && (busy || !!url))}
			autocomplete="off"
			spellcheck="false"
		/>
		{#if mode === 'search' && query}<button
				type="button"
				class="icon-button"
				aria-label="Clear search"
				onclick={() => (query = '')}><X /></button
			>{:else if mode === 'insert' && !url}<button
				class="icon-button"
				aria-label="Continue adding bookmark"
				disabled={!ready || !draft.trim() || busy}><ArrowRight /></button
			>{/if}
	</form>
	{#if mode === 'insert' && url}
		<form
			class="capture-picker"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<div class="section-heading">
				<strong>{created ? 'Saved. Finish organizing.' : 'Make it yours'}</strong><button
					type="button"
					class="text-button"
					onclick={() => switchMode('search')}>Keep draft & close</button
				>
			</div>
			<fieldset disabled={busy} class="stack">
				{#if !created}<div class="capture-link-actions">
						<button type="button" class="text-button" onclick={() => (url = '')}>Edit link</button
						><button type="button" class="text-button" onclick={discardDraft}>Discard draft</button>
					</div>{/if}
				<label for="bookmark-capture-title">Title <span class="muted">optional</span></label><input
					id="bookmark-capture-title"
					bind:this={titleInput}
					bind:value={title}
					disabled={created}
					maxlength="500"
					placeholder="Give this link a memorable name"
				/>
				<label for="capture-organizer">Tags & people</label>
				<div class="capture-chips">
					{#each selected as choice (key(choice))}<button
							type="button"
							class="chip"
							disabled={completed.includes(key(choice))}
							onclick={() => toggle(choice)}
							aria-label={`Remove ${choice.name}`}
							>{#if choice.kind === 'person'}<UserRound />{:else}<Folder />{/if}{choice.name}<X
							/></button
						>{/each}
				</div>
				<input
					id="capture-organizer"
					bind:value={organizer}
					placeholder="Find tags or people…"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							if (choices[0]) toggle(choices[0]);
						}
					}}
				/>
				<div class="capture-choices">
					{#each choices as choice (key(choice))}<button
							type="button"
							aria-pressed={selected.some((c) => key(c) === key(choice))}
							disabled={completed.includes(key(choice))}
							onclick={() => toggle(choice)}
							>{#if choice.kind === 'person'}<UserRound />{:else}<Folder />{/if}<span
								>{choice.name}</span
							>{#if selected.some((c) => key(c) === key(choice))}<Check />{:else}<small
									>{choice.kind}</small
								>{/if}</button
						>{/each}
					{#if canCreate}<button
							type="button"
							onclick={() => {
								toggle({ kind: 'new-tag', id: '', name: tagName });
								organizer = '';
							}}><Plus /><span>Create tag “{tagName}”</span></button
						>{/if}
				</div>
				<label for="capture-collection">Collection</label><select
					id="capture-collection"
					bind:value={collection}
					><option value="">No collection</option
					>{#each collections as item (String(item.id))}<option value={String(item.id)}
							>{item.name}</option
						>{/each}</select
				>
				<div class="capture-footer">
					<span class="muted"
						>{busy ? 'Saving on this device…' : 'Sync happens in the background.'}</span
					><button type="submit" class="primary-button"
						>{busy ? 'Saving…' : created ? 'Finish saving' : 'Save bookmark'}<ArrowRight /></button
					>
				</div>
			</fieldset>
		</form>{/if}
	{#if error}<p class="form-error" role="alert">{error}</p>{/if}
</section>
