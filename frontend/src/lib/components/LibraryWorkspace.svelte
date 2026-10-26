<script lang="ts">
	import {
		Bookmark as BookmarkIcon,
		ChevronDown as ChevronDownIcon,
		X as XIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links use validated external HTTP URLs. App navigation uses resolve. */
	import { onMount, tick } from 'svelte';
	import { Keyboard, Shuffle } from '@lucide/svelte';
	import AccountPanel from './AccountPanel.svelte';
	import KeyboardHelp from './KeyboardHelp.svelte';
	import { libraryKeyboard } from '#lib/client/keyboard-navigation.js';
	import { SvelteURL } from 'svelte/reactivity';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { AlertDialog, Dialog, DropdownMenu } from 'bits-ui';
	import Omnibar from './Omnibar.svelte';
	import LibrarySidebar from './LibrarySidebar.svelte';
	import MobileNavbar from './MobileNavbar.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import { avatarFromSeed, type AvatarConfig } from '#lib/domain/avatars.js';
	import { createPeopleFeedIndex } from '#lib/client/people-feed.js';
	import { cue } from '#lib/client/sounds.svelte.js';
	import TokenInput from './ui/TokenInput.svelte';
	import BookmarkCard from './BookmarkCard.svelte';
	import { notePreview } from '#lib/client/reference-edits.js';
	import { isReadLater, personSlug, personIdFromSlug } from '#lib/client/workflows.js';

	import { createLibraryClient, type LibraryClient } from '#lib/client/vault/library.js';
	import { createSearchClient } from '#lib/client/search-client.js';
	import { emptySearch, type searchLibrary } from '#lib/client/search.js';
	import {
		exportLibrary,
		previewImport,
		importLibrary,
		type ImportResult
	} from '#lib/client/vault/portability.js';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { VaultIdentity } from '#lib/domain/replica.js';
	import type { Command, Revision } from '#lib/domain/contracts.js';
	import LibraryInspector from './LibraryInspector.svelte';
	import TagsExplorer from './TagsExplorer.svelte';
	let {
		openOffline = false,
		identity = null,
		personSlug: profileSlug = ''
	}: { openOffline?: boolean; identity?: VaultIdentity | null; personSlug?: string } = $props();

	type Row = Record<string, unknown>;
	// The facade owns its mutable state and notifies via version; do not proxy its snapshots.
	let library = $state.raw<LibraryClient | null>(null),
		version = $state(0),
		sort = $state('newest'),
		toast = $state(''),
		creating = $state(false),
		formBusy = $state(false),
		importBusy = $state(false),
		formError = $state('');
	let newType = $state('person'),
		newTitle = $state(''),
		newNote = $state(''),
		personUrl = $state(''),
		editingPerson = $state<Row | null>(null);
	let captureId = $state('');
	let avatarConfig = $state<AvatarConfig | null>(null);
	let sidebarCollapsed = $state(false),
		mobile = $state(false),
		navSearching = $state(false),
		wideEditor = $state(false);
	let feedFilter = $state('all');
	const buildProfileIndex = createPeopleFeedIndex();
	let results = $state<ReturnType<typeof searchLibrary>>({ items: [], filter: emptySearch() }),
		limit = $state(100);
	let importData = $state<unknown>(null),
		importOpen = $state(false),
		importReport = $state<ImportResult | null>(null),
		importProgress = $state(''),
		importPreview = $state<ReturnType<typeof previewImport> | null>(null);
	let settings = $state(false),
		purgeOpen = $state(false),
		purgeTarget = $state<Row | null>(null),
		manage = $state<{ table: 'tags'; row: Row } | null>(null),
		rename = $state('');
	let omnibar: Omnibar | undefined = $state();
	let sidebar: LibrarySidebar | undefined = $state();
	let tagsExplorer: TagsExplorer | undefined = $state();
	let helpOpen = $state(false);
	let lastRow: HTMLElement | null = null;
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingResults: Promise<void> | undefined;
	async function focusLibrary() {
		const initial = lastRow?.isConnected
			? lastRow
			: document.querySelector<HTMLElement>('.bookmark-title, .person-card');
		const fallback = document.getElementById('library-main');
		(initial ?? fallback)?.focus({ preventScroll: true });
		await tick();
		await pendingResults;
		await tick();
		// A search may finish after Escape. Restore a row only if the user has
		// not already moved focus elsewhere while those results were loading.
		if (document.activeElement !== fallback && document.activeElement !== document.body) return;
		const row = lastRow?.isConnected
			? lastRow
			: document.querySelector<HTMLElement>('.bookmark-title, .person-card');
		(row ?? document.getElementById('library-main'))?.focus({ preventScroll: true });
	}
	let editorReturnId = '';
	$effect(() => {
		if (selected) editorReturnId = selected.id;
	});
	let searcher: ReturnType<typeof createSearchClient> | undefined,
		generation = 0;
	const status = $derived.by(() => {
		void version;
		return library ? { ...library.state } : null;
	});
	const contentVersion = $derived(status?.contentVersion ?? 0);
	const libraryReady = $derived(status?.ready ?? false);
	const personId = $derived(personIdFromSlug(profileSlug));
	const requestedView = $derived(page.url.searchParams.get('view') ?? 'all');
	const view = $derived(
		profileSlug
			? 'person'
			: ['all', 'later', 'trash', 'people', 'tags'].includes(requestedView) ||
				  requestedView.startsWith('tag:')
				? requestedView
				: 'all'
	);
	const people = $derived.by(() => {
		void version;
		return library?.list<Row>('people').filter((p) => !p.deletedAt && !p.purgedAt) ?? [];
	});
	const person = $derived(people.find((p) => p.id === personId));
	const personWebsite = $derived.by(() => {
		try {
			return normalizeUrl(String(person?.website)).url;
		} catch {
			return null;
		}
	});
	const noteBodies = $derived.by(() => {
		void version;
		return new Map(
			library?.list<Row>('notes').map((n) => [String(n.entityId), String(n.bodyMarkdown)]) ?? []
		);
	});
	const selected = $derived.by(() => {
		const id = page.url.searchParams.get('item'),
			kind = page.url.searchParams.get('kind');
		return id && kind === 'bookmark' ? ({ id, kind } as EntityRef) : null;
	});
	const tags = $derived.by(() => {
		void version;
		return library?.list<Row>('tags').filter((r) => !r.deletedAt) ?? [];
	});
	const title = $derived(
		(view === 'person' ? (person?.displayName ?? 'Person') : undefined) ??
			(
				{
					all: 'All bookmarks',
					later: 'Read later',
					trash: 'Trash',
					people: 'People',
					tags: 'Tags'
				} as Record<string, string>
			)[view] ??
			(view.startsWith('tag:') ? tags.find((t) => t.id === view.slice(4))?.name : undefined) ??
			'Library'
	);
	const profileLinks = $derived.by(() => {
		void contentVersion;
		return buildProfileIndex(view === 'people' || profileSlug ? library : null);
	});
	let query = $derived(page.url.searchParams.get('q') ?? '');
	let content: HTMLElement | undefined = $state();
	// On mobile the search field is at the bottom, so ranked results read upward from it.
	const bottomUp = $derived(mobile && !!query && view !== 'people' && !profileSlug);
	$effect(() => {
		if (!bottomUp) return;
		void results;
		void tick().then(() => content?.scrollTo({ top: content.scrollHeight }));
	});
	$effect(() => {
		void contentVersion;
		const current = library,
			search = searcher;
		if (!current || !libraryReady || !search || view === 'tags') return;
		const n = ++generation;
		const profile = personId;
		const entries = profileLinks.get(profile ?? '');
		const connected = new Set(
			[...(entries ?? [])]
				.filter(
					([, labels]) =>
						feedFilter === 'all' ||
						(feedFilter === 'authored'
							? labels.includes('Authored')
							: feedFilter === 'mentions'
								? labels.includes('Mentioned')
								: labels.some((label) => label === 'Related' || label === 'About'))
				)
				.map(([id]) => id)
		);
		pendingResults = search
			.query(current, view, query, sort)
			.then((value) => {
				if (n === generation)
					results = profileSlug
						? {
								...value,
								items: value.items.filter(
									(i) => i.entityKind === 'bookmark' && connected.has(String(i.id))
								)
							}
						: value;
			})
			.catch((e) => {
				if (n === generation) toast = (e as Error).message;
			});
	});
	onMount(() => {
		const media = window.matchMedia('(min-width: 1200px)');
		const resize = () => (wideEditor = media.matches);
		resize();
		media.addEventListener('change', resize);
		const narrow = window.matchMedia('(max-width: 767px)');
		const layout = () => (mobile = narrow.matches);
		layout();
		narrow.addEventListener('change', layout);
		searcher = createSearchClient();
		const client = createLibraryClient(() => {
			version++;
		});
		library = client;
		void client.start(identity ?? undefined).then(() => {
			if (openOffline) return client.openCached().catch((error: Error) => feedback(error.message));
		});
		const key = libraryKeyboard({
			insert: () => void openOmnibar('insert'),
			filter: () => void (mobile ? openTags() : sidebar?.focusNavigation()),
			account: () => (settings = true),
			help: () => (helpOpen = true)
		});
		const remember = (event: FocusEvent) => {
			const target = event.target as HTMLElement;
			if (target.matches('.bookmark-title, .person-card')) lastRow = target;
		};
		window.addEventListener('keydown', key);
		window.addEventListener('focusin', remember);
		return () => {
			media.removeEventListener('change', resize);
			narrow.removeEventListener('change', layout);
			window.removeEventListener('keydown', key);
			window.removeEventListener('focusin', remember);
			clearTimeout(feedbackTimer);
			client.stop();
			searcher?.stop();
		};
	});
	// On mobile the omnibar lives in the bottom navbar and must be revealed before it can take focus.
	async function openOmnibar(next: 'insert' | 'search') {
		if (mobile) {
			navSearching = true;
			await tick();
		}
		await (next === 'insert' ? omnibar?.focusInsert() : omnibar?.focusSearch());
	}
	async function openTags() {
		navSearching = false;
		if (view !== 'tags') await navigate(null, 'tags');
		await tick();
		tagsExplorer?.focusSearch();
	}
	function feedback(message: string) {
		toast = message;
		clearTimeout(feedbackTimer);
		feedbackTimer = setTimeout(() => (toast = ''), 6500);
	}
	async function navigate(target: EntityRef | null, nextView?: string) {
		if (target?.kind === 'person') {
			const row = library?.get<Row>('people', target.id);
			if (row) await goto(resolve('/people/[slug]', { slug: personSlug(row) }));
			return;
		}
		if (target?.kind === 'persona') return;
		const url = new SvelteURL(page.url.href);
		if (nextView) url.pathname = resolve('/');
		// The tags page filters its own list; a leftover library search would send it back to all.
		if (nextView === 'tags') query = '';
		if (nextView) {
			url.searchParams.set('view', nextView);
			url.searchParams.delete('item');
			url.searchParams.delete('kind');
			limit = 100;
		}
		if (target) {
			url.searchParams.set('item', target.id);
			url.searchParams.set('kind', target.kind);
		} else if (!nextView) {
			url.searchParams.delete('item');
			url.searchParams.delete('kind');
		}
		if (query) url.searchParams.set('q', query);
		else url.searchParams.delete('q');
		await goto(url, { reset: false });
	}
	// Tag counts and shelf sizes for the tags page, from live bookmark rows.
	const shelfStats = $derived.by(() => {
		void version;
		const counts: Record<string, number> = {};
		const shelves = { later: 0, people: people.length, trash: 0 };
		if (view !== 'tags') return { counts, shelves };
		for (const row of library?.list<Row>('bookmarks') ?? []) {
			if (row.purgedAt) continue;
			if (row.deletedAt) {
				shelves.trash++;
				continue;
			}
			if (isReadLater(row)) shelves.later++;
			for (const id of (row.tagIds as string[]) ?? []) counts[id] = (counts[id] ?? 0) + 1;
		}
		return { counts, shelves };
	});
	// The tags page has no bookmark list, so a library search moves back to all bookmarks.
	$effect(() => {
		if (view === 'tags' && query) void navigate(null, 'all');
	});
	function create(type: string, name = '') {
		if (formBusy) return;
		if (type === 'bookmark') {
			void openOmnibar('insert');
			return;
		}
		if (!['person', 'tag'].includes(type)) return;
		newType = type;
		personUrl = '';
		editingPerson = null;
		captureId = crypto.randomUUID();
		avatarConfig = avatarFromSeed(captureId);
		newTitle = name;
		newNote = '';
		formError = '';
		creating = true;
	}
	function editPerson() {
		if (!person) return;
		create('person');
		editingPerson = person;
		newTitle = String(person.displayName);
		personUrl = String(person.website ?? '');
		newNote = String(person.bio ?? '');
		avatarConfig =
			(person.avatarConfig as AvatarConfig | null) ?? avatarFromSeed(String(person.id));
	}
	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		if (!library || formBusy) return;
		formBusy = true;
		formError = '';
		const id = editingPerson ? String(editingPerson.id) : captureId;
		try {
			// The outbox clones commands; reactive avatar proxies must become plain data first.
			const savedAvatar = $state.snapshot(avatarConfig);
			const command: Command =
				newType === 'person'
					? editingPerson
						? {
								type: 'person.update',
								id,
								expectedRevision: String(editingPerson.revision) as Revision,
								patch: {
									displayName: newTitle,
									website: personUrl || null,
									bio: newNote,
									avatarConfig: savedAvatar
								}
							}
						: {
								type: 'person.create',
								id,
								displayName: newTitle,
								website: personUrl || null,
								bio: newNote,
								avatarConfig: savedAvatar
							}
					: { type: 'tag.create', id, name: newTitle };
			const result = await library.save(command);
			if (result.status === 'rejected') throw new Error(result.message ?? 'Could not save.');
			creating = false;
			cue('success');
			feedback(status?.online ? 'Saved.' : 'Saved on this device.');
			if (newType === 'person') await navigate({ kind: 'person', id });
			else await navigate(null, `tag:${id}`);
		} catch (e) {
			formError = (e as Error).message;
			cue('error');
		} finally {
			formBusy = false;
		}
	}
	async function bookmarkAction(item: Row, action: 'later' | 'trash' | 'restore' | 'purge') {
		if (!library) return;
		const row = library.get<Row>('bookmarks', String(item.id));
		if (!row) return;
		if (action === 'purge') {
			purgeTarget = row;
			purgeOpen = true;
			return;
		}
		const command: Command =
			action === 'trash' || action === 'restore'
				? {
						type: `bookmark.${action}`,
						id: String(row.id),
						expectedRevision: String(row.revision) as Revision
					}
				: {
						type: 'bookmark.organize',
						id: String(row.id),
						expectedRevision: String(row.revision) as Revision,
						patch: { readingStatus: isReadLater(row) ? 'unread' : 'reading' }
					};
		try {
			const result = await library.save(command);
			cue(result.status === 'rejected' ? 'error' : action === 'trash' ? 'warning' : 'success');
			feedback(result.message ?? 'Saved on this device.');
		} catch (error) {
			cue('error');
			feedback((error as Error).message);
		}
	}
	async function purgeBookmark() {
		const target = purgeTarget;
		// AlertDialog.Action does not close the dialog by itself.
		purgeOpen = false;
		if (!library || !target) return;
		const row = library.get<Row>('bookmarks', String(target.id));
		if (!row) return;
		try {
			const result = await library.save({
				type: 'bookmark.purge',
				id: String(row.id),
				expectedRevision: String(row.revision) as Revision
			});
			if (result.status === 'rejected')
				throw new Error(result.message ?? 'Could not delete bookmark.');
			cue('success');
			feedback('Deleted permanently.');
		} catch (error) {
			cue('error');
			feedback((error as Error).message);
		} finally {
			purgeTarget = null;
		}
	}
	async function connectContent(id: string) {
		if (!library || !personId) return;
		const result = await library.save({
			type: 'content-person.add',
			bookmarkId: id,
			personId,
			role: 'related',
			provenance: 'manual'
		});
		if (result.status === 'rejected')
			throw new Error(result.message ?? 'Could not connect bookmark.');
	}
	async function disconnectContent(id: string) {
		if (!library || !personId) return;
		for (const row of library
			.list<Row>('relationships')
			.filter((r) => !r.deletedAt && r.personId === personId && r.bookmarkId === id)) {
			const result = await library.save({
				type: 'content-person.remove',
				bookmarkId: id,
				personId,
				role: row.role as 'related'
			});
			if (result.status === 'rejected')
				throw new Error(result.message ?? 'Could not disconnect bookmark.');
		}
	}
	const connectedIds = $derived.by(() => {
		void version;
		return [
			...new Set(
				library
					?.list<Row>('relationships')
					.filter((r) => !r.deletedAt && r.personId === personId)
					.map((r) => String(r.bookmarkId)) ?? []
			)
		];
	});
	const contentChoices = $derived.by(() => {
		void version;
		return (
			library
				?.list<Row>('bookmarks')
				.filter((r) => !r.deletedAt && !r.purgedAt)
				.map((r) => ({
					value: String(r.id),
					label: String(r.title),
					search: String(r.description ?? '') + ' ' + String(noteBodies.get(String(r.id)) ?? '')
				})) ?? []
		);
	});

	function download(value: unknown, name: string) {
		const url = URL.createObjectURL(
			new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
				type: 'application/json'
			})
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}
	async function exportData() {
		if (!library) return;
		try {
			download(
				await exportLibrary(library),
				`prism-v0-${new Date().toISOString().slice(0, 10)}.json`
			);
			feedback('Metadata exported. Media bytes are not included.');
		} catch (e) {
			feedback((e as Error).message);
		}
	}
	async function pickImport(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 10 * 1024 * 1024) {
			feedback('Choose a metadata export smaller than 10 MiB.');
			return;
		}
		try {
			importData = JSON.parse(await file.text());
			importPreview = previewImport(importData);
			importReport = null;
			importOpen = true;
		} catch {
			feedback('This file is not valid Prism JSON.');
		}
		(event.target as HTMLInputElement).value = '';
	}
	async function runImport() {
		if (!library) return;
		importBusy = true;
		try {
			importReport = await importLibrary(
				library,
				importData,
				(p) => (importProgress = `${p.phase}: ${p.accepted} accepted, ${p.skipped} skipped`)
			);
			feedback(
				importReport.status === 'complete'
					? 'Import finished. Review its report.'
					: 'Import stopped. Download the report before retrying.'
			);
		} catch (e) {
			feedback((e as Error).message);
		} finally {
			importBusy = false;
		}
	}
	async function runMaintenance() {
		try {
			const response = await fetch('/api/v1/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 10 })
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.message ?? 'Maintenance could not run.');
			feedback(
				`Cleanup: ${data.completed} complete, ${data.pending} pending, ${data.failed} failed in this run.`
			);
		} catch (e) {
			feedback((e as Error).message);
		}
	}
	async function manageSave(remove = false) {
		if (!library || !manage) return;
		const entry = manage;
		const id = String(entry.row.id);
		try {
			if (remove) {
				// The server refuses to delete a tag that still has members, so detach it first.
				for (const table of ['bookmarks', 'people', 'personas'] as const)
					for (const row of library.list<Row>(table)) {
						if (row.purgedAt || !((row.tagIds as string[] | undefined) ?? []).includes(id))
							continue;
						const result = await library.save({
							type: 'tag.remove',
							id: String(row.id),
							tagId: id
						});
						if (result.status === 'rejected')
							throw new Error(result.message ?? 'Could not remove this tag from every item.');
					}
			}
			const current = library.get<Row>('tags', id) ?? entry.row;
			const command: Command = remove
				? {
						type: 'tag.delete',
						id,
						expectedRevision: String(current.revision) as Revision
					}
				: {
						type: 'tag.rename',
						id,
						expectedRevision: String(current.revision) as Revision,
						name: rename
					};
			const outcome = await library.save(command);
			feedback(outcome.message ?? (remove ? 'Tag deleted.' : 'Saved.'));
			if (outcome.status === 'rejected') {
				cue('error');
				return;
			}
			cue(remove ? 'warning' : 'success');
			manage = null;
			if (remove && view === `tag:${id}`) await navigate(null, 'tags');
		} catch (e) {
			cue('error');
			feedback((e as Error).message);
		}
	}
</script>

{#snippet omnibarSlot()}<Omnibar
		bind:this={omnibar}
		{library}
		ready={!!status?.ready}
		{tags}
		{people}
		bind:query
		{personId}
		{feedback}
		onNormal={focusLibrary}
		onDismiss={() => (navSearching = false)}
	/>{/snippet}
<svelte:head
	>{#if profileSlug}<title>{person?.displayName ?? 'Person'} · Prism</title>{/if}</svelte:head
>
<a class="skip-link" href="#library-main">Skip to content</a>
<div
	class="library-shell"
	class:sidebar-collapsed={sidebarCollapsed}
	class:editor-open={!!selected}
	class:mobile-layout={mobile}
>
	<LibrarySidebar
		bind:this={sidebar}
		{view}
		{tags}
		bind:collapsed={sidebarCollapsed}
		onSelect={(value) => void navigate(null, value)}
		onCreate={create}
		onAccount={() => (settings = true)}
	/>
	<main id="library-main" class="library-main" tabindex="-1">
		<h1 class="view-title" class:inline-heading={!!profileSlug || view === 'tags'}>{title}</h1>
		{#if !mobile}<div class="workspace-search">{@render omnibarSlot()}</div>{/if}
		<div class="library-content" class:results-bottom-up={bottomUp} bind:this={content}>
			{#if profileSlug && person}<div class="person-profile">
					<div class="profile-cover" aria-hidden="true"></div>
					<PersonAvatar id={String(person.id)} config={person.avatarConfig} size={88} />
					<div class="profile-copy">
						<h2>{person.displayName}</h2>
						{#if person.bio}<p class="person-bio">{person.bio}</p>{/if}{#if personWebsite}<a
								class="source-link"
								href={personWebsite}
								target="_blank"
								rel="noopener noreferrer">{personWebsite}</a
							>{/if}
					</div>
					<button class="text-button" onclick={editPerson} data-cuelume-open>Edit profile</button>
				</div>{/if}

			{#if profileSlug && person}<div class="profile-feed-heading">
					<span>{profileLinks.get(String(person.id))?.size ?? 0} saved connections</span>
					<div class="feed-filters" aria-label="Filter profile feed">
						{#each [{ id: 'all', label: 'All' }, { id: 'authored', label: 'Authored' }, { id: 'related', label: 'Related' }, { id: 'mentions', label: 'Mentions' }] as option (option.id)}<button
								aria-pressed={feedFilter === option.id}
								onclick={() => (feedFilter = option.id)}>{option.label}</button
							>{/each}
					</div>
				</div>{/if}
			{#if profileSlug && status?.ready && person}<section class="person-connect">
					<TokenInput
						label="Connect existing bookmarks"
						placeholder="Connect saved content to this person…"
						showSelected={false}
						items={contentChoices}
						selected={connectedIds}
						onAdd={connectContent}
						onRemove={disconnectContent}
					/>
				</section>{/if}

			{#if !status?.ready}<section class="welcome-panel">
					<div class="empty-icon"><BookmarkIcon /></div>
					<h2>
						{status?.loading ? 'Opening your library…' : 'Your bookmarks, together.'}
					</h2>
					<p>Save links, add context, find them when you need them.</p>
					{#if status?.error}<p class="form-error" role="alert">
							{status.error}
						</p>{/if}{#if !status?.loading}<a class="primary-button" href={resolve('/auth/sign-in')}
							>Sign in to your library</a
						><button onclick={() => library?.sync()}>Try connecting again</button
						>{#if status && !status.online}<button
								onclick={() =>
									library?.openCached().catch((error: Error) => feedback(error.message))}
								>Open cached library on this trusted device</button
							>{/if}{/if}
				</section>
			{:else if view === 'tags'}
				<TagsExplorer
					bind:this={tagsExplorer}
					{tags}
					counts={shelfStats.counts}
					shelves={shelfStats.shelves}
					onSelect={(value) => void navigate(null, value)}
					onCreate={(name) => create('tag', name)}
				/>
			{:else}
				<div class="list-toolbar">
					<button
						class="column-sort"
						onclick={() => (sort = sort === 'title' ? 'newest' : 'title')}
						aria-label="Sort by title"
						>{view === 'people' ? 'Name' : 'Title'}{sort === 'title' ? ' ↑' : ''}</button
					>
					{#if query}<span class="muted">{results.items.length} found</span>{/if}
					{#if view === 'people'}<button class="text-button" onclick={() => create('person')}
							>Add person</button
						>{:else}<button
							class="list-shortcuts"
							aria-label="Keyboard shortcuts"
							onclick={() => (helpOpen = true)}><kbd>?</kbd> shortcuts</button
						>{/if}
					<DropdownMenu.Root
						><DropdownMenu.Trigger class="column-sort date-sort" aria-label="Sort results"
							>{sort === 'recently_opened' ? 'Last opened' : 'Created at'}<ChevronDownIcon
							/></DropdownMenu.Trigger
						><DropdownMenu.Portal
							><DropdownMenu.Content class="menu-content" align="end" sideOffset={5}>
								{#each [{ value: 'newest', label: 'Newest first' }, { value: 'title', label: 'Title A–Z' }, { value: 'recently_opened', label: 'Recently opened' }] as option (option.value)}<DropdownMenu.Item
										class="menu-item"
										onSelect={() => (sort = option.value)}>{option.label}</DropdownMenu.Item
									>{/each}
							</DropdownMenu.Content></DropdownMenu.Portal
						></DropdownMenu.Root
					>
				</div>

				{#if results.error}<p class="notice inset" role="alert">{results.error}</p>{/if}

				<div
					class="bookmark-list"
					class:person-timeline={!!profileSlug}
					class:people-grid={view === 'people'}
				>
					{#if profileSlug && !person}<p class="panel-message">
							This person is unavailable.
						</p>{:else}
						{#each results.items.slice(0, limit) as item (String(item.id))}
							{#if item.entityKind === 'person'}<button
									class="person-card"
									onclick={() => navigate({ kind: 'person', id: String(item.id) })}
									><PersonAvatar id={String(item.id)} config={item.avatarConfig} size={56} /><span
										><strong>{item.displayName}</strong><small
											>{item.bio || item.website || 'A person worth keeping up with.'}</small
										><span class="person-count"
											>{profileLinks.get(String(item.id))?.size ?? 0} saved connections</span
										></span
									></button
								>
							{:else}<BookmarkCard
									{item}
									{feedback}
									note={notePreview(noteBodies.get(String(item.id)) ?? '')}
									timeline={!!profileSlug}
									relation={profileSlug
										? (profileLinks.get(personId ?? '')?.get(String(item.id)) ?? []).join(' · ')
										: ''}
									tagLabels={((item.tagIds as string[]) ?? [])
										.map((id) => String(tags.find((t) => t.id === id)?.name ?? ''))
										.filter(Boolean)}
									onDisconnect={profileSlug && connectedIds.includes(String(item.id))
										? () =>
												void disconnectContent(String(item.id)).catch((e) => feedback(e.message))
										: undefined}
									selected={selected?.id === item.id}
									onEdit={() => void navigate({ kind: 'bookmark', id: String(item.id) })}
									onAction={(action) => void bookmarkAction(item, action)}
									onOpen={() => void library?.save({ type: 'activity.open', id: String(item.id) })}
								/>{/if}
						{:else}{#if !results.error}<section class="welcome-panel compact">
									<div class="empty-state-mark"><BookmarkIcon /></div>
									<h2>
										{query
											? 'Nothing matched this search.'
											: view === 'people'
												? 'People behind your bookmarks.'
												: profileSlug
													? 'Their saved content appears here.'
													: 'No bookmarks here yet.'}
									</h2>
									<p>
										{query
											? 'Try a title, note or #tag.'
											: profileSlug
												? 'Connect an existing bookmark above, or save a new one here.'
												: 'Paste a link above to save your first bookmark.'}
									</p>
									{#if !query && view !== 'trash'}<button
											class="primary-button"
											onclick={() => create(view === 'people' ? 'person' : 'bookmark')}
											>Add {view === 'people' ? 'person' : 'bookmark'}</button
										>{/if}
								</section>{/if}{/each}{/if}
				</div>

				{#if results.items.length > limit}<button class="load-more" onclick={() => (limit += 100)}
						>Show more</button
					>{/if}
			{/if}
		</div>
	</main>
	{#if mobile && status?.ready}<MobileNavbar
			bind:searching={navSearching}
			{view}
			onSelect={(value) => {
				navSearching = false;
				void navigate(null, value);
			}}
			onAccount={() => (settings = true)}
			onSearch={() => void openOmnibar('search')}
			omnibar={omnibarSlot}
		/>{/if}
	{#if toast && !settings}<div class="action-toast" role="status">
			<span>{toast}</span><button
				class="icon-button"
				aria-label="Dismiss message"
				onclick={() => (toast = '')}><XIcon /></button
			>
		</div>{/if}
</div>

<Dialog.Root
	open={!!selected}
	onOpenChange={(open) => {
		if (!open) void navigate(null);
	}}
>
	<Dialog.Portal
		><Dialog.Overlay class="dialog-overlay editor-overlay" /><Dialog.Content
			trapFocus={!wideEditor}
			preventScroll={!wideEditor}
			preventOverflowTextSelection={!wideEditor}
			onInteractOutside={(event) => {
				if (wideEditor) event.preventDefault();
			}}
			class="dialog-content editor-dialog"
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				document
					.querySelector<HTMLElement>(`[data-bookmark-id="${editorReturnId}"] .bookmark-title`)
					?.focus();
			}}
		>
			{#snippet child({ props })}<div {...props} aria-modal={wideEditor ? undefined : true}>
					<Dialog.Title class="sr-only">Edit bookmark</Dialog.Title>
					<Dialog.Description class="sr-only"
						>Edit your bookmark, notes, tags, and connected people. Changes save automatically.</Dialog.Description
					>
					{#if library && selected}{#key selected.id}<LibraryInspector
								{library}
								entity={selected}
								{version}
								navigate={(target) => void navigate(target)}
								{feedback}
								close={() => void navigate(null)}
							/>{/key}{/if}
				</div>{/snippet}
		</Dialog.Content></Dialog.Portal
	>
</Dialog.Root>

<Dialog.Root bind:open={creating}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content capture-dialog">
			<Dialog.Title class="dialog-title"
				>{newType === 'person'
					? editingPerson
						? 'Edit person'
						: 'Add person'
					: 'Add tag'}</Dialog.Title
			>
			<Dialog.Description class="sr-only">Add a name and optional details.</Dialog.Description>
			<form class="stack capture-form" onsubmit={submitCreate}>
				<fieldset disabled={formBusy}>
					{#if newType === 'person'}<div class="avatar-picker">
							<PersonAvatar
								id={editingPerson ? String(editingPerson.id) : captureId}
								config={avatarConfig}
								size={88}
							/>
							<div>
								<strong>A face for the name</strong>
								<p class="muted">A little personality. One click.</p>
								<button
									type="button"
									class="secondary-button"
									onclick={() => (avatarConfig = avatarFromSeed(crypto.randomUUID()))}
									><Shuffle /> Randomize</button
								>
							</div>
						</div>{/if}
					<label for="capture-title">Name</label><input
						id="capture-title"
						bind:value={newTitle}
						required
						maxlength={newType === 'person' ? 200 : 64}
						placeholder={newType === 'person' ? 'Full name' : 'Name'}
					/>
					{#if newType === 'person'}
						<label for="person-url">Website (optional)</label><input
							id="person-url"
							type="url"
							bind:value={personUrl}
							placeholder="https://…"
						/>
						<label for="capture-note">About (optional)</label><textarea
							id="capture-note"
							bind:value={newNote}
							rows="2"
							placeholder="A little context about this person"></textarea>
					{/if}
					{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
					<button type="submit" class="primary-button" disabled={formBusy}
						>{formBusy ? 'Saving…' : 'Save'}</button
					>
				</fieldset>
			</form>
			<Dialog.Close
				class="icon-button dialog-close"
				disabled={formBusy}
				aria-label="Close creation form"><XIcon /></Dialog.Close
			>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
<AccountPanel
	bind:open={settings}
	{library}
	{status}
	{tags}
	{toast}
	{feedback}
	onCreate={create}
	onManage={(entry) => {
		manage = entry;
		rename = String(entry.row.name);
	}}
	onExport={exportData}
	onImport={pickImport}
	onExportPending={async () => {
		if (library) download(await library.exportPending(), 'prism-pending-work.json');
	}}
	onMaintenance={runMaintenance}
/>
<Dialog.Root bind:open={helpOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content keyboard-dialog"
			><Dialog.Title class="dialog-title"><Keyboard /> Keyboard shortcuts</Dialog.Title
			><Dialog.Description class="dialog-description"
				>A little muscle memory goes a long way.</Dialog.Description
			><KeyboardHelp /><Dialog.Close
				class="icon-button dialog-close"
				aria-label="Close keyboard shortcuts"><XIcon /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root bind:open={importOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content v0-dialog"
			><Dialog.Title class="dialog-title">Import preview</Dialog.Title><Dialog.Description
				class="dialog-description"
				>Import copies metadata into new identities. Existing saved URLs and their notes are kept.
				This can take several separate saves.</Dialog.Description
			>{#if importPreview}<pre class="import-preview">{JSON.stringify(
						importPreview.counts,
						null,
						2
					)}</pre>
				{#each importPreview.errors as error (error)}<p class="form-error">
						{error}
					</p>{/each}{#each importPreview.warnings as warning (warning)}<p class="muted">
						{warning}
					</p>{/each}<button
					class="primary-button"
					onclick={runImport}
					disabled={importBusy ||
						!importPreview.valid ||
						!!importReport ||
						!status?.online ||
						!!status?.pending}>{importBusy ? 'Importing…' : 'Import copy'}</button
				>{/if}
			<p role="status">{importProgress}</p>
			{#if importReport}<p>
					{importReport.status === 'complete' ? 'Import finished.' : 'Import stopped.'}
					{importReport.blockedNotes.length} notes need review.
				</p>
				<button onclick={() => download(importReport, 'prism-import-report.json')}
					>Download report and recoverable notes</button
				>{#if importReport.error}<p class="form-error">
						{importReport.error}
					</p>{/if}{/if}<Dialog.Close
				class="icon-button dialog-close"
				aria-label="Close import"
				disabled={importBusy}><XIcon /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root
	open={!!manage}
	onOpenChange={(value) => {
		if (!value) manage = null;
	}}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content v0-dialog"
			><Dialog.Title class="dialog-title">Manage {manage?.row.name}</Dialog.Title
			><Dialog.Description class="dialog-description"
				>Renaming preserves connections. Deleting removes the tag from its bookmarks; the bookmarks
				stay.</Dialog.Description
			>
			<div class="stack">
				<label for="manage-name">Name</label><input
					id="manage-name"
					bind:value={rename}
					maxlength="64"
				/><button class="primary-button" onclick={() => manageSave()}>Rename</button><button
					onclick={() => manageSave(true)}>Delete</button
				>
			</div>
			<p role="status">{toast}</p>
			<Dialog.Close class="icon-button dialog-close" aria-label="Close management"
				><XIcon /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<AlertDialog.Root
	bind:open={purgeOpen}
	onOpenChange={(open) => {
		purgeOpen = open;
		if (!open) purgeTarget = null;
	}}
>
	<AlertDialog.Portal
		><AlertDialog.Overlay class="dialog-overlay" /><AlertDialog.Content class="dialog-content"
			><AlertDialog.Title class="dialog-title">Delete bookmark permanently?</AlertDialog.Title
			><AlertDialog.Description class="dialog-description"
				>This removes the bookmark and its note. It cannot be undone.</AlertDialog.Description
			>
			<div class="button-row dialog-actions">
				<AlertDialog.Cancel class="secondary-button">Keep in trash</AlertDialog.Cancel
				><AlertDialog.Action class="danger-button" onclick={() => void purgeBookmark()}
					>Delete permanently</AlertDialog.Action
				>
			</div></AlertDialog.Content
		></AlertDialog.Portal
	></AlertDialog.Root
>
