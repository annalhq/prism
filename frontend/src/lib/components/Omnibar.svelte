<script lang="ts" module>
	// Shared across mounts so a title fetched while typing is ready when the link is confirmed.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- A plain request cache; nothing renders from it.
	const titleRequests = new Map<string, Promise<string>>();
	function requestTitle(target: string): Promise<string> {
		const existing = titleRequests.get(target);
		if (existing) return existing;
		const request = fetch(`/api/v1/metadata?url=${encodeURIComponent(target)}`, {
			headers: { accept: 'application/json' }
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('Title lookup failed.');
				const payload: unknown = await response.json();
				return payload &&
					typeof payload === 'object' &&
					typeof (payload as { title?: unknown }).title === 'string'
					? (payload as { title: string }).title.trim()
					: '';
			})
			.catch((error) => {
				titleRequests.delete(target);
				throw error;
			});
		if (titleRequests.size >= 50) titleRequests.delete(titleRequests.keys().next().value!);
		titleRequests.set(target, request);
		return request;
	}
</script>

<script lang="ts">
	import { Plus, Search, X, ArrowRight, Hash, UserRound, CornerDownLeft } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { ensureTag, inferBookmarkKind, type Row } from '#lib/client/workflows.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { cue, foregroundSound } from '#lib/client/sounds.svelte.js';
	import Favicon from './ui/Favicon.svelte';
	type Choice = { kind: 'tag' | 'person' | 'new-tag'; id: string; name: string };
	let {
		library,
		ready,
		tags,
		people,
		query = $bindable(''),
		personId = null,
		onNormal,
		onDismiss,
		dismissible = false,
		readonly = false
	}: {
		library: LibraryClient | null;
		ready: boolean;
		tags: Row[];
		people: Row[];
		query?: string;
		personId?: string | null;
		onNormal: () => void;
		onDismiss?: () => void;
		// The bar can be closed from its own trailing control (the mobile navbar search).
		dismissible?: boolean;
		// Search only: the leading icon stays a plain magnifier and nothing can be saved.
		readonly?: boolean;
	} = $props();
	let mode = $state<'insert' | 'search'>('search');
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
	let organizing = $state(false),
		active = $state(0);
	let titleRequestedFor = '',
		prefetchTimer: ReturnType<typeof setTimeout> | undefined;
	let input = $state<HTMLInputElement>(),
		titleInput = $state<HTMLInputElement>(),
		organizerInput = $state<HTMLInputElement>();
	let restoredScope = $state('');
	const key = (choice: Choice) => `${choice.kind}:${choice.id || choice.name}`;
	// "#" narrows to tags and "@" to people, the same syntax search uses.
	const scope = $derived(
		organizer.startsWith('#') ? 'tag' : organizer.startsWith('@') ? 'person' : ''
	);
	const needle = $derived(organizer.trim().replace(/^[#@]/, '').toLocaleLowerCase());
	const choices = $derived(
		[
			...tags.map((t) => ({ kind: 'tag' as const, id: String(t.id), name: String(t.name) })),
			...people.map((p) => ({
				kind: 'person' as const,
				id: String(p.id),
				name: String(p.displayName)
			}))
		]
			.filter(
				(c) =>
					(!scope || c.kind === scope) &&
					!selected.some((s) => key(s) === key(c)) &&
					c.name.toLocaleLowerCase().includes(needle)
			)
			// Names that start with the query rank above names that merely contain it.
			.sort(
				(a, b) =>
					Number(!a.name.toLocaleLowerCase().startsWith(needle)) -
					Number(!b.name.toLocaleLowerCase().startsWith(needle))
			)
			.slice(0, 6)
	);
	const tagName = $derived(organizer.trim().replace(/^#/, ''));
	const canCreate = $derived(
		!!tagName &&
			!organizer.startsWith('@') &&
			!tags.some((t) => String(t.name).toLocaleLowerCase() === tagName.toLocaleLowerCase()) &&
			!selected.some((c) => c.name.toLocaleLowerCase() === tagName.toLocaleLowerCase())
	);
	const options = $derived<Choice[]>(
		canCreate ? [...choices, { kind: 'new-tag', id: '', name: tagName }] : choices
	);
	const suggesting = $derived(organizing && options.length > 0);
	$effect(() => {
		void organizer;
		active = 0;
	});
	const host = $derived(url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
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
		void tick().then(() => input?.focus());
	}
	function cancelTitleFetch() {
		titleRequestedFor = '';
		titleLoading = false;
	}
	function captureUrl(value: string): string {
		const text = value.trim();
		return normalizeUrl(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`).url;
	}
	// Start the title lookup while the link is still in the field, so it is usually done
	// before the capture card opens.
	function prefetchTitle(value: string, delay = 300) {
		clearTimeout(prefetchTimer);
		prefetchTimer = setTimeout(() => {
			try {
				const target = captureUrl(value);
				if (/\.[a-z\d-]{2,}$/i.test(new URL(target).hostname))
					void requestTitle(target).catch(() => {});
			} catch {
				/* Not a link yet. */
			}
		}, delay);
	}
	async function loadTitle(target: string) {
		if (!target || created || titleEdited || titleRequestedFor === target) return;
		titleRequestedFor = target;
		titleLoading = true;
		try {
			const value = await requestTitle(target);
			if (titleRequestedFor !== target || titleEdited || busy || created) return;
			if (value) {
				title = value;
				autoTitle = value;
			}
		} catch {
			if (titleRequestedFor === target) titleRequestedFor = '';
		} finally {
			if (titleRequestedFor === target || !titleRequestedFor) titleLoading = false;
		}
	}
	async function editLink() {
		if (busy || created) return;
		cancelTitleFetch();
		if (title.trim() && title === autoTitle) {
			title = '';
			autoTitle = '';
			titleEdited = false;
		}
		url = '';
		await tick();
		input?.focus();
		input?.select();
	}
	function add(choice: Choice) {
		if (!selected.some((c) => key(c) === key(choice))) selected = [...selected, choice];
		organizer = '';
		organizerInput?.focus();
	}
	function remove(choice: Choice) {
		if (completed.includes(key(choice))) return;
		selected = selected.filter((c) => key(c) !== key(choice));
		organizerInput?.focus();
	}
	// Text still in the organizer is a tag or person the user meant to add, e.g. typing
	// "cyber" and pressing Ctrl+Enter. Prefer an exact match; otherwise create the tag.
	function commitOrganizer() {
		if (!needle) return;
		const choice =
			choices.find((c) => c.name.toLocaleLowerCase() === needle) ??
			(canCreate ? { kind: 'new-tag' as const, id: '', name: tagName } : choices[0]);
		if (choice) add(choice);
	}
	function organizerKey(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (e.key === 'ArrowDown' && suggesting) {
			e.preventDefault();
			active = (active + 1) % options.length;
		} else if (e.key === 'ArrowUp' && suggesting) {
			e.preventDefault();
			active = (active - 1 + options.length) % options.length;
		} else if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',') && organizer.trim()) {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			if (options[active]) add(options[active]);
		} else if (e.key === 'Backspace' && !organizer) {
			const last = selected.findLast((c) => !completed.includes(key(c)));
			if (last) {
				e.preventDefault();
				remove(last);
			}
		} else if (e.key === 'Escape' && organizer) {
			// The first Escape clears the field; the next one closes the card.
			e.preventDefault();
			organizer = '';
		}
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
					'[role="dialog"][aria-modal="true"],[role="alertdialog"],[role="menu"],[role="listbox"]:not(.capture-options)'
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
		return () => {
			window.removeEventListener('keydown', listener);
			clearTimeout(prefetchTimer);
		};
	});
	export async function focusSearch() {
		await switchMode('search');
	}
	export async function focusInsert() {
		await switchMode('insert');
	}
	// Touch devices have no quick paste shortcut, so a copied link fills the empty field.
	// The read starts before any await so it still counts as part of the user's tap.
	function pasteCopiedLink() {
		if (draft || url || !matchMedia('(pointer: coarse)').matches || !navigator.clipboard?.readText)
			return;
		navigator.clipboard
			.readText()
			.then((text) => {
				const link = text.trim();
				if (draft || url || mode !== 'insert' || link.length > 2048) return;
				if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(link)) return;
				// The link appearing in the field is its own confirmation.
				draft = link;
				prefetchTitle(link, 0);
			})
			.catch(() => {
				/* Permission denied or nothing to read: the user can still paste by hand. */
			});
	}
	async function switchMode(next: 'insert' | 'search') {
		if (readonly) next = 'search';
		if (next === 'insert') pasteCopiedLink();
		mode = next;
		await tick();
		if (next === 'insert' && url) {
			void loadTitle(url);
			await focusCard();
		} else input?.focus();
	}
	async function focusCard() {
		await tick();
		if (created) organizerInput?.focus();
		else titleInput?.focus();
	}
	// One trailing control, whose job follows the bar's state: clear what was typed,
	// otherwise close the bar where it can be closed.
	function clearOrClose() {
		if (mode === 'search' && query) {
			query = '';
			input?.focus();
		} else if (mode === 'insert' && draft) {
			draft = '';
			input?.focus();
		} else {
			mode = 'search';
			onDismiss?.();
		}
	}
	function prepare(event: SubmitEvent) {
		event.preventDefault();
		if (mode === 'search' || busy || !ready) return;
		error = '';
		try {
			url = captureUrl(draft);
			captureId = crypto.randomUUID();
			created = false;
			completed = [];
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
			void focusCard();
		} catch {
			error = 'Enter a valid website link, such as example.com/article.';
			cue('error');
		}
	}
	async function save() {
		if (!library || busy || !ready || !url) return;
		commitOrganizer();
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

			// The new row appearing in the list is the confirmation; only the sound marks it.
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
		} catch (e) {
			error = (e as Error).message;
			cue('error');
		} finally {
			stopLoading();
			busy = false;
		}
	}
	const trailing = $derived(
		mode === 'search'
			? query
				? 'clear'
				: dismissible
					? 'close'
					: 'shortcut'
			: url
				? 'none'
				: draft.trim()
					? 'continue'
					: dismissible
						? 'close'
						: 'none'
	);
	const apple = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
	const pop = { duration: 160, start: 0.6, easing: cubicOut };
</script>

<section
	class="omnibar-section"
	aria-label={readonly ? 'Search bookmarks' : 'Search and save bookmarks'}
>
	<form class="omnibar" class:search-mode={mode === 'search'} onsubmit={prepare}>
		{#if readonly}<span class="omnibar-leading" aria-hidden="true"
				><span class="omnibar-glyph"><Search /></span></span
			>{:else}
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
		{/if}
		<input
			bind:this={input}
			aria-label={mode === 'search' ? 'Search library' : 'Bookmark URL'}
			placeholder={mode === 'search' ? 'Search, #tag or @person…' : 'Paste a link to save…'}
			value={mode === 'search' ? query : draft}
			oninput={(e) => {
				if (mode === 'search') query = e.currentTarget.value;
				else {
					draft = e.currentTarget.value;
					prefetchTitle(
						draft,
						(e as unknown as InputEvent).inputType === 'insertFromPaste' ? 0 : 300
					);
				}
			}}
			onkeydown={(e) => {
				// The first Escape clears what was typed; the next one leaves the bar.
				if (e.key !== 'Escape' || e.isComposing) return;
				if (mode === 'search' && query) {
					e.preventDefault();
					query = '';
				} else if (mode === 'insert' && draft && !url) {
					e.preventDefault();
					draft = '';
				}
			}}
			disabled={!ready || (mode === 'insert' && (busy || !!url))}
			autocomplete="off"
			spellcheck="false"
		/>
		<span class="omnibar-trailing">
			{#key trailing}
				{#if trailing === 'clear' || trailing === 'close'}<button
						type="button"
						class="omnibar-clear"
						aria-label={trailing === 'close'
							? 'Close search'
							: mode === 'search'
								? 'Clear search'
								: 'Clear link'}
						title={trailing === 'close' ? 'Close · Esc' : 'Clear · Esc'}
						onclick={clearOrClose}
						in:scale={pop}><X /></button
					>{:else if trailing === 'shortcut'}<kbd
						class="omnibar-shortcut"
						aria-hidden="true"
						in:scale={pop}>/</kbd
					>{:else if trailing === 'continue'}<button
						type="submit"
						class="omnibar-continue"
						aria-label="Continue adding bookmark"
						disabled={!ready || busy}
						in:scale={pop}><ArrowRight /></button
					>{/if}
			{/key}
		</span>
	</form>
	{#if mode === 'insert' && url}
		<form
			class="capture-picker"
			aria-label="Save bookmark"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<fieldset disabled={busy}>
				<button
					type="button"
					class="capture-source"
					title={created ? url : `${url} · Edit link`}
					disabled={created}
					onclick={editLink}
					><Favicon {url} /><span>{host}</span>{#if !created}<small>Edit</small>{/if}</button
				>
				<div class="capture-title-field">
					<input
						id="bookmark-capture-title"
						bind:this={titleInput}
						bind:value={title}
						aria-label="Title"
						oninput={() => (titleEdited = true)}
						onkeydown={(e) => {
							if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
								e.preventDefault();
								organizerInput?.focus();
							}
						}}
						disabled={created}
						maxlength="500"
						placeholder={titleLoading ? '' : 'Untitled'}
						aria-busy={titleLoading}
					/>
					{#if titleLoading && !title}<span class="title-shimmer" aria-hidden="true"
							>Fetching title…</span
						>{/if}
				</div>
				<div class="capture-organizer">
					<!-- The whole token row is the field's hit area. -->
					<label class="capture-tokens">
						{#each selected as choice (key(choice))}<span
								class="capture-token"
								class:person={choice.kind === 'person'}
								class:done={completed.includes(key(choice))}
								animate:flip={{ duration: 180, easing: cubicOut }}
								transition:scale={{ duration: 150, start: 0.8, easing: cubicOut }}
								>{#if choice.kind === 'person'}<UserRound />{:else}<Hash />{/if}{choice.name}<button
									type="button"
									aria-label={`Remove ${choice.name}`}
									disabled={completed.includes(key(choice))}
									onclick={() => remove(choice)}><X /></button
								></span
							>{/each}
						<input
							id="capture-organizer"
							bind:this={organizerInput}
							bind:value={organizer}
							role="combobox"
							aria-label="Tags and people"
							aria-expanded={suggesting}
							aria-controls="capture-options"
							aria-autocomplete="list"
							aria-activedescendant={suggesting ? `capture-option-${active}` : undefined}
							placeholder={selected.length ? '' : 'Add tags or people…'}
							autocomplete="off"
							spellcheck="false"
							onfocus={() => (organizing = true)}
							onblur={() => (organizing = false)}
							onkeydown={organizerKey}
						/>
					</label>
					{#if suggesting}<ul
							id="capture-options"
							class="capture-options"
							role="listbox"
							aria-label="Suggestions"
							transition:scale={{ duration: 140, start: 0.97, easing: cubicOut }}
						>
							{#each options as choice, index (key(choice))}<li
									id={`capture-option-${index}`}
									role="option"
									aria-selected={index === active}
									class:active={index === active}
									onpointerenter={() => (active = index)}
									onpointerdown={(e) => {
										// Keep focus in the field so the list stays open for the next pick.
										e.preventDefault();
										add(choice);
									}}
								>
									{#if choice.kind === 'new-tag'}<Plus /><span>Create <b>#{choice.name}</b></span
										>{:else}{#if choice.kind === 'person'}<UserRound />{:else}<Hash />{/if}<span
											>{choice.name}</span
										>{/if}
									{#if index === active}<CornerDownLeft class="capture-option-enter" />{/if}
								</li>{/each}
						</ul>{/if}
				</div>
				<div class="capture-footer">
					{#if created}<span class="capture-hint">Saved. Finish organizing.</span>{:else}<button
							type="button"
							class="text-button"
							onclick={discardDraft}>Discard</button
						>{/if}
					<span class="capture-submit">
						<kbd class="capture-kbd" aria-hidden="true">{apple ? '⌘' : 'Ctrl'} ↵</kbd>
						<button type="submit" class="primary-button" class:busy
							>{busy ? 'Saving…' : created ? 'Finish' : 'Save'}</button
						>
					</span>
				</div>
			</fieldset>
		</form>{/if}
	{#if error}<p class="form-error" role="alert">{error}</p>{/if}
</section>
