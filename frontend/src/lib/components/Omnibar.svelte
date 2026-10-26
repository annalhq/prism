<script lang="ts">
	import { Plus, Search, X, ArrowRight, ArrowLeft, Folder, UserRound, Check } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { ensureTag, inferBookmarkKind, type Row } from '#lib/client/workflows.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { cue, foregroundSound } from '#lib/client/sounds.svelte.js';
	type Choice = { kind: 'tag' | 'person' | 'new-tag'; id: string; name: string };
	let {
		library,
		ready,
		tags,
		people,
		query = $bindable(''),
		personId = null,
		feedback,
		onNormal,
		onDismiss
	}: {
		library: LibraryClient | null;
		ready: boolean;
		tags: Row[];
		people: Row[];
		query?: string;
		personId?: string | null;
		feedback: (message: string) => void;
		onNormal: () => void;
		onDismiss?: () => void;
	} = $props();
	let mode = $state<'insert' | 'search'>('search');
	let step = $state<'title' | 'organize'>('title');
	let draft = $state(''),
		title = $state(''),
		url = $state(''),
		organizer = $state(''),
		error = $state(''),
		busy = $state(false);
	let selected = $state<Choice[]>([]),
		completed = $state<string[]>([]),
		captureId = $state(''),
		created = $state(false),
		titleLoading = $state(false),
		titleEdited = $state(false),
		autoTitle = $state('');
	let titleController: AbortController | null = null,
		titleRequestedFor = '';
	let input = $state<HTMLInputElement>(),
		titleInput = $state<HTMLInputElement>(),
		organizerInput = $state<HTMLInputElement>();
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
		cancelTitleFetch();
		draft = '';
		title = '';
		autoTitle = '';
		titleEdited = false;
		url = '';
		organizer = '';
		selected = [];
		completed = [];
		captureId = '';
		error = '';
		step = 'title';
	}
	function cancelTitleFetch() {
		titleController?.abort();
		titleController = null;
		titleRequestedFor = '';
		titleLoading = false;
	}
	async function loadTitle(target: string) {
		if (!target || created || titleEdited || titleRequestedFor === target) return;
		titleRequestedFor = target;
		titleController?.abort();
		const controller = new AbortController();
		titleController = controller;
		titleLoading = true;
		try {
			const response = await fetch(`/api/v1/metadata?url=${encodeURIComponent(target)}`, {
				signal: controller.signal,
				headers: { accept: 'application/json' }
			});
			if (!response.ok) throw new Error('Title lookup failed.');
			const payload: unknown = await response.json();
			const value =
				payload &&
				typeof payload === 'object' &&
				typeof (payload as { title?: unknown }).title === 'string'
					? (payload as { title: string }).title.trim()
					: '';
			if (
				controller.signal.aborted ||
				titleRequestedFor !== target ||
				titleEdited ||
				busy ||
				created
			)
				return;
			if (value) {
				title = value;
				autoTitle = value;
			}
		} catch {
			if (!controller.signal.aborted && titleRequestedFor === target) titleRequestedFor = '';
		} finally {
			if (titleController === controller) {
				titleController = null;
				titleLoading = false;
			}
		}
	}
	function editLink() {
		cancelTitleFetch();
		if (title.trim() && title === autoTitle) {
			title = '';
			autoTitle = '';
			titleEdited = false;
		}
		url = '';
		step = 'title';
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
				step = created ? 'organize' : 'title';
				titleEdited = title.trim().length > 0;
				autoTitle = '';
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
				const capturing = mode === 'insert' && !!url;
				mode = 'search';
				onNormal();
				if (!capturing) onDismiss?.();
			}
		};
		window.addEventListener('keydown', listener);
		return () => window.removeEventListener('keydown', listener);
	});
	export async function focusSearch() {
		await switchMode('search');
	}
	export async function focusInsert() {
		await switchMode('insert');
	}
	async function switchMode(next: 'insert' | 'search') {
		mode = next;
		await tick();
		if (next === 'insert' && url) {
			void loadTitle(url);
			await focusStep();
		} else input?.focus();
	}
	async function goTo(next: 'title' | 'organize') {
		step = created ? 'organize' : next;
		await focusStep();
	}
	async function focusStep() {
		await tick();
		if (step === 'title') titleInput?.focus();
		else organizerInput?.focus();
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
			step = 'title';
			const previousAutoTitle = title.trim().length > 0 && title === autoTitle;
			if (previousAutoTitle) {
				title = '';
				autoTitle = '';
				titleEdited = false;
			} else {
				titleEdited = title.trim().length > 0;
				autoTitle = '';
			}
			cancelTitleFetch();
			void loadTitle(url);
			if (personId && !selected.some((c) => c.kind === 'person' && c.id === personId))
				selected = [
					...selected,
					{
						kind: 'person',
						id: personId,
						name: String(people.find((p) => p.id === personId)?.displayName ?? 'This person')
					}
				];
			void focusStep();
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

			feedback('Saved on this device.');
			cue('success');
			cancelTitleFetch();
			draft = '';
			title = '';
			autoTitle = '';
			titleEdited = false;
			url = '';
			organizer = '';
			selected = [];
			completed = [];
			created = false;
			captureId = '';
			step = 'title';
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
	<form class="omnibar" class:search-mode={mode === 'search'} onsubmit={prepare}>
		<!-- One leading switch flips the bar between finding and saving; no duplicate buttons. -->
		<button
			type="button"
			class="omnibar-leading"
			class:insert={mode === 'insert'}
			disabled={!ready}
			aria-label={mode === 'search' ? 'Switch to add bookmark' : 'Switch to search'}
			title={mode === 'search' ? 'Add a bookmark · i' : 'Search · /'}
			onclick={() => switchMode(mode === 'search' ? 'insert' : 'search')}
			><span class="omnibar-glyph search-glyph"><Search /></span><span
				class="omnibar-glyph insert-glyph"><Plus /></span
			></button
		>
		<input
			bind:this={input}
			aria-label={mode === 'search' ? 'Search library' : 'Bookmark URL'}
			placeholder={mode === 'search' ? 'Search bookmarks…' : 'Paste a link to save…'}
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
				class="omnibar-clear"
				aria-label="Clear search"
				onclick={() => (query = '')}><X /></button
			>{:else if mode === 'search'}<kbd class="omnibar-shortcut" aria-hidden="true">/</kbd>{/if}
		{#if mode === 'insert' && !url}<button
				type="submit"
				class="omnibar-continue"
				aria-label="Continue adding bookmark"
				disabled={!ready || !draft.trim() || busy}><ArrowRight /></button
			>{/if}
	</form>
	{#if mode === 'insert' && url}
		<form
			class="capture-picker"
			onsubmit={(e) => {
				e.preventDefault();
				if (step === 'title') void goTo('organize');
				else void save();
			}}
		>
			<div class="capture-header">
				<ol class="capture-steps" aria-label="Capture steps">
					<li class="done">Link</li>
					<li class:current={step === 'title'} class:done={step === 'organize'}>Title</li>
					<li class:current={step === 'organize'}>Organize</li>
				</ol>
				<button type="button" class="text-button" onclick={() => switchMode('search')}
					>{created ? 'Close' : 'Keep draft'}</button
				>
			</div>
			<p class="capture-url" title={url}>{url.replace(/^https?:\/\/(www\.)?/, '')}</p>
			<fieldset disabled={busy} class="stack">
				{#key step}<div class="capture-step">
						{#if step === 'title'}
							<label for="bookmark-capture-title">Title <span class="muted">optional</span></label>
							<div class="capture-title-field">
								<input
									id="bookmark-capture-title"
									bind:this={titleInput}
									bind:value={title}
									oninput={() => (titleEdited = true)}
									disabled={created}
									maxlength="500"
									placeholder={titleLoading ? '' : 'Give this link a memorable name'}
									aria-busy={titleLoading}
								/>
								{#if titleLoading && !title}<span class="title-shimmer" aria-hidden="true"
										>Fetching title…</span
									>{/if}
							</div>
						{:else}
							<label for="capture-organizer">Tags & people</label>
							<div class="capture-chips">
								{#each selected as choice (key(choice))}<button
										type="button"
										class="chip"
										disabled={completed.includes(key(choice))}
										onclick={() => toggle(choice)}
										aria-label={`Remove ${choice.name}`}
										>{#if choice.kind === 'person'}<UserRound />{:else}<Folder
											/>{/if}{choice.name}<X /></button
									>{/each}
							</div>
							<input
								id="capture-organizer"
								bind:this={organizerInput}
								bind:value={organizer}
								placeholder="Find tags or people…"
								autocomplete="off"
								onkeydown={(e) => {
									if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
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
						{/if}
					</div>{/key}

				<div class="capture-footer">
					{#if step === 'organize' && !created}<button
							type="button"
							class="text-button"
							onclick={() => goTo('title')}><ArrowLeft /> Back</button
						>{:else if !created}<span class="capture-link-actions"
							><button type="button" class="text-button" onclick={editLink}>Edit link</button
							><button type="button" class="text-button" onclick={discardDraft}>Discard</button
							></span
						>{:else}<span class="muted">Saved. Finish organizing.</span>{/if}
					<span class="capture-submit">
						{#if step === 'title'}<button
								type="button"
								class="text-button"
								title="Save now · Ctrl+Enter"
								onclick={() => void save()}>Save now</button
							><button type="submit" class="primary-button">Next<ArrowRight /></button
							>{:else}<button type="submit" class="primary-button"
								>{busy ? 'Saving…' : created ? 'Finish saving' : 'Save bookmark'}<ArrowRight
								/></button
							>{/if}
					</span>
				</div>
			</fieldset>
		</form>{/if}
	{#if error}<p class="form-error" role="alert">{error}</p>{/if}
</section>
