<script lang="ts">
	import {
		Bookmark as BookmarkIcon,
		ChevronDown as ChevronDownIcon,
		X as XIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links use validated external HTTP URLs. App navigation uses resolve. */
	import { onMount, tick } from 'svelte';
	import { UserRound, Keyboard, Menu, Shuffle } from '@lucide/svelte';
	import ViewPicker from './ViewPicker.svelte';
	import AccountPanel from './AccountPanel.svelte';
	import KeyboardHelp from './KeyboardHelp.svelte';
	import { libraryKeyboard } from '#lib/client/keyboard-navigation.js';
	import { SvelteURL } from 'svelte/reactivity';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Dialog, DropdownMenu } from 'bits-ui';
	import Omnibar from './Omnibar.svelte';
	import LibrarySidebar from './LibrarySidebar.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import { avatarFromSeed, type AvatarConfig } from '#lib/domain/avatars.js';
	import { createPeopleFeedIndex } from '#lib/client/people-feed.js';
	import { cue, foregroundSound } from '#lib/client/sounds.svelte.js';
	import SelectField from './ui/SelectField.svelte';
	import TokenInput from './ui/TokenInput.svelte';
	import BookmarkCard from './BookmarkCard.svelte';
	import { notePreview } from '#lib/client/reference-edits.js';
	import { ensureTag, isReadLater, personSlug, personIdFromSlug } from '#lib/client/workflows.js';

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
		bulkBusy = $state(false),
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
		mobileNavigation = $state(false),
		wideEditor = $state(false),
		selectionMode = $state(false);
	let feedFilter = $state('all');
	const buildProfileIndex = createPeopleFeedIndex();
	let bulkQueue = Promise.resolve();
	let results = $state<ReturnType<typeof searchLibrary>>({ items: [], filter: emptySearch() }),
		limit = $state(100),
		selectedIds = $state<string[]>([]),
		bulkTag = $state(''),
		bulkCollection = $state('');
	let importData = $state<unknown>(null),
		importOpen = $state(false),
		importReport = $state<ImportResult | null>(null),
		importProgress = $state(''),
		importPreview = $state<ReturnType<typeof previewImport> | null>(null);
	let settings = $state(false),
		manage = $state<{ table: 'tags' | 'collections' | 'savedSearches'; row: Row } | null>(null),
		rename = $state('');
	let omnibar: Omnibar | undefined = $state();
	let viewPicker: ViewPicker | undefined = $state();
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
	const view = $derived(
		profileSlug
			? 'person'
			: ['inbox', 'personas'].includes(page.url.searchParams.get('view') ?? '')
				? 'all'
				: (page.url.searchParams.get('view') ?? 'all')
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
	const collections = $derived.by(() => {
		void version;
		return library?.list<Row>('collections').filter((r) => !r.deletedAt) ?? [];
	});
	const saved = $derived.by(() => {
		void version;
		return library?.list<Row>('savedSearches').filter((r) => !r.deletedAt) ?? [];
	});
	const title = $derived(
		(view === 'person' ? (person?.displayName ?? 'Person') : undefined) ??
			(
				{
					all: 'All bookmarks',
					later: 'Read later',
					pinned: 'Pinned',
					archive: 'Archive',
					trash: 'Trash',
					people: 'People'
				} as Record<string, string>
			)[view] ??
			(view.startsWith('tag:')
				? tags.find((t) => t.id === view.slice(4))?.name
				: view.startsWith('collection:')
					? collections.find((c) => c.id === view.slice(11))?.name
					: saved.find((s) => s.id === view.slice(6))?.name) ??
			'Library'
	);
	const profileLinks = $derived.by(() => {
		void contentVersion;
		return buildProfileIndex(view === 'people' || profileSlug ? library : null);
	});
	let query = $derived(page.url.searchParams.get('q') ?? '');
	$effect(() => {
		void contentVersion;
		const current = library,
			search = searcher;
		if (!current || !libraryReady || !search) return;
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
		searcher = createSearchClient();
		const client = createLibraryClient(() => {
			version++;
		});
		library = client;
		void client.start(identity ?? undefined).then(() => {
			if (openOffline) return client.openCached().catch((error: Error) => feedback(error.message));
		});
		const key = libraryKeyboard({
			insert: () => void omnibar?.focusInsert(),
			filter: () => viewPicker?.show(),
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
			window.removeEventListener('keydown', key);
			window.removeEventListener('focusin', remember);
			clearTimeout(feedbackTimer);
			client.stop();
			searcher?.stop();
		};
	});
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
		if (nextView) {
			url.searchParams.set('view', nextView);
			url.searchParams.delete('item');
			url.searchParams.delete('kind');
			selectedIds = [];
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
	function create(type: string) {
		if (formBusy) return;
		if (type === 'bookmark') {
			void omnibar?.focusInsert();
			return;
		}
		newType = type;
		personUrl = '';
		editingPerson = null;
		captureId = crypto.randomUUID();
		avatarConfig = avatarFromSeed(captureId);
		newTitle = '';
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
									avatarConfig
								}
							}
						: {
								type: 'person.create',
								id,
								displayName: newTitle,
								website: personUrl || null,
								bio: newNote,
								avatarConfig
							}
					: newType === 'saved-search'
						? {
								type: 'saved-search.create',
								id,
								name: newTitle,
								filter: results.filter,
								sort: sort as 'newest'
							}
						: ({ type: `${newType}.create`, id, name: newTitle } as Command);
			const result = await library.save(command);
			if (result.status === 'rejected') throw new Error(result.message ?? 'Could not save.');
			creating = false;
			cue('success');
			feedback(status?.online ? 'Saved.' : 'Saved on this device.');
			if (newType === 'person') await navigate({ kind: 'person', id });
			else await navigate(null, `${newType === 'saved-search' ? 'saved' : newType}:${id}`);
		} catch (e) {
			formError = (e as Error).message;
			cue('error');
		} finally {
			formBusy = false;
		}
	}
	async function bookmarkAction(item: Row, action: 'later' | 'archive' | 'trash' | 'restore') {
		if (!library) return;
		const row = library.get<Row>('bookmarks', String(item.id));
		if (!row) return;
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
						patch:
							action === 'later'
								? { readingStatus: isReadLater(row) ? 'unread' : 'reading' }
								: { isArchived: !row.archivedAt }
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

	function bulk(action: 'tag' | 'person' | 'collection' | 'archive' | 'trash', target = '') {
		const ids = [...selectedIds],
			tag = bulkTag,
			collection = bulkCollection;
		const work = bulkQueue.then(() => runBulk(action, target, ids, tag, collection));
		bulkQueue = work.catch(() => {});
		return work;
	}
	async function runBulk(
		action: 'tag' | 'person' | 'collection' | 'archive' | 'trash',
		target: string,
		ids: string[],
		tag: string,
		collection: string
	) {
		if (!library) return;
		bulkBusy = true;
		let completed = 0;
		const failed: string[] = [];
		const stopLoading = foregroundSound();
		try {
			for (const id of ids) {
				const row = library.get<Row>('bookmarks', id);
				if (!row || row.deletedAt) {
					failed.push(id);
					continue;
				}
				const command: Command =
					action === 'person'
						? {
								type: 'content-person.add',
								bookmarkId: id,
								personId: target,
								role: 'related',
								provenance: 'manual'
							}
						: action === 'tag'
							? { type: 'tag.add', id, tagId: tag }
							: action === 'trash'
								? { type: 'bookmark.trash', id, expectedRevision: String(row.revision) as Revision }
								: {
										type: 'bookmark.organize',
										id,
										expectedRevision: String(row.revision) as Revision,
										patch:
											action === 'archive'
												? { isArchived: true }
												: { collectionId: collection || null }
									};
				try {
					const result = await library.save(command);
					if (result.status === 'rejected') failed.push(id);
					else completed++;
				} catch {
					failed.push(id);
				}
			}
			if (action === 'trash' || action === 'archive')
				selectedIds = selectedIds.filter((id) => !ids.includes(id) || failed.includes(id));
			feedback(
				`${completed} items saved on this device.${failed.length ? ` ${failed.length} could not be saved; their selection is preserved.` : ''}`
			);
			cue(failed.length ? 'error' : action === 'trash' ? 'warning' : 'success');
		} finally {
			bulkBusy = false;
			stopLoading();
		}
	}
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
		const type =
			entry.table === 'tags'
				? 'tag'
				: entry.table === 'collections'
					? 'collection'
					: 'saved-search';
		const command = remove
			? { type: `${type}.delete`, id: entry.row.id, expectedRevision: entry.row.revision }
			: type === 'saved-search'
				? {
						type: 'saved-search.update',
						id: entry.row.id,
						expectedRevision: entry.row.revision,
						name: rename,
						filter: entry.row.filter,
						sort: entry.row.sort
					}
				: {
						type: `${type}.rename`,
						id: entry.row.id,
						expectedRevision: entry.row.revision,
						name: rename
					};
		const outcome = await library.save(command as Command);
		feedback(outcome.message ?? 'Saved.');
		if (outcome.status !== 'rejected') manage = null;
	}
</script>

<svelte:head
	>{#if profileSlug}<title>{person?.displayName ?? 'Person'} · Prism</title>{/if}</svelte:head
>
<a class="skip-link" href="#library-main">Skip to content</a>
<div
	class="library-shell"
	class:sidebar-collapsed={sidebarCollapsed}
	class:editor-open={!!selected}
	class:selection-mode={selectionMode || !!selectedIds.length}
>
	<LibrarySidebar
		{view}
		{tags}
		{collections}
		{saved}
		bind:collapsed={sidebarCollapsed}
		bind:mobileOpen={mobileNavigation}
		onSelect={(value) => void navigate(null, value)}
		onCreate={create}
		onAccount={() => (settings = true)}
	/>
	<header class="library-header">
		<button
			class="icon-button mobile-menu-button"
			aria-label="Open library navigation"
			onclick={() => (mobileNavigation = true)}
			data-cuelume-open><Menu /></button
		>
		<nav aria-label="Library navigation">
			<ViewPicker
				bind:this={viewPicker}
				{title}
				{view}
				{tags}
				{collections}
				{saved}
				onSelect={(value) => void navigate(null, value)}
			/>
		</nav>
		<button
			class="account-button"
			aria-label="Account and library settings"
			data-cuelume-open
			onclick={() => (settings = true)}><span class="account-avatar"><UserRound /></span></button
		>
	</header>
	<main id="library-main" class="library-main" tabindex="-1">
		<div class="workspace-heading">
			<div>
				<p class="eyebrow">YOUR PERSONAL LIBRARY</p>
				<h1>{title}</h1>
			</div>
			<span class="workspace-status"
				><span class:offline={!status?.online}></span>{status?.pending
					? `${status.pending} queued`
					: status?.online
						? 'Connected'
						: 'Offline'}</span
			>
		</div>
		<Omnibar
			bind:this={omnibar}
			{library}
			ready={!!status?.ready}
			{tags}
			{people}
			{collections}
			bind:query
			{personId}
			{feedback}
			onNormal={focusLibrary}
		/>
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
							onclick={() => library?.openCached().catch((error: Error) => feedback(error.message))}
							>Open cached library on this trusted device</button
						>{/if}{/if}
			</section>
		{:else}
			<div class="list-toolbar">
				{#if view !== 'people'}<button
						class="text-button"
						aria-pressed={selectionMode}
						onclick={() => {
							selectionMode = !selectionMode;
							if (!selectionMode) selectedIds = [];
						}}>{selectionMode ? 'Done selecting' : 'Select'}</button
					>{/if}
				<button
					class="column-sort"
					onclick={() => (sort = sort === 'title' ? 'newest' : 'title')}
					aria-label="Sort by title"
					>{view === 'people' ? 'Name' : 'Title'}{sort === 'title' ? ' ↑' : ''}</button
				>
				{#if query}<span class="muted">{results.items.length} found</span><button
						class="text-button"
						onclick={() => create('saved-search')}>Save search</button
					>{:else if view === 'people'}<button class="text-button" onclick={() => create('person')}
						>Add person</button
					>{:else}<button
						class="list-shortcuts"
						aria-label="Keyboard shortcuts"
						onclick={() => (helpOpen = true)}
						><kbd>j</kbd><kbd>k</kbd> navigate <span>·</span><kbd>?</kbd> shortcuts</button
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
			{#if selectedIds.length}<div class="bulk-bar">
					<strong>{selectedIds.length} selected</strong><button
						class="text-button"
						onclick={() => (selectedIds = [])}>Clear</button
					><button
						class="text-button"
						onclick={() =>
							(selectedIds = results.items
								.filter((item) => item.entityKind === 'bookmark' && !item.deletedAt)
								.slice(0, limit)
								.map((item) => String(item.id)))}>Select visible</button
					><TokenInput
						label="Bulk tags"
						placeholder="Tag selected bookmarks…"
						allowCreate
						items={tags.map((t) => ({ value: String(t.id), label: String(t.name) }))}
						onAdd={async (value, create) => {
							if (!library) return;
							bulkTag = create ? await ensureTag(library, value) : value;
							await bulk('tag');
						}}
					/>
					<TokenInput
						label="Connect selected to people"
						placeholder="Connect people…"
						items={people.map((p) => ({ value: String(p.id), label: String(p.displayName) }))}
						onAdd={async (value) => {
							await bulk('person', value);
						}}
					/>
					<SelectField
						label="Bulk collection"
						bind:value={bulkCollection}
						options={[
							{ value: '', label: 'No collection' },
							...collections.map((r) => ({ value: String(r.id), label: String(r.name) }))
						]}
					/><button onclick={() => bulk('collection')} disabled={bulkBusy}>Move</button><button
						onclick={() => bulk('archive')}
						disabled={bulkBusy}>Archive</button
					><button onclick={() => bulk('trash')} disabled={bulkBusy}>Trash</button>
				</div>{/if}
			<div
				class="bookmark-list"
				class:person-timeline={!!profileSlug}
				class:people-grid={view === 'people'}
			>
				{#if profileSlug && !person}<p class="panel-message">This person is unavailable.</p>{:else}
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
								note={notePreview(
									noteBodies.get(String(item.id)) ?? String(item.description ?? '')
								)}
								timeline={!!profileSlug}
								relation={profileSlug
									? (profileLinks.get(personId ?? '')?.get(String(item.id)) ?? []).join(' · ')
									: ''}
								tagLabels={((item.tagIds as string[]) ?? [])
									.map((id) => String(tags.find((t) => t.id === id)?.name ?? ''))
									.filter(Boolean)}
								onDisconnect={profileSlug && connectedIds.includes(String(item.id))
									? () => void disconnectContent(String(item.id)).catch((e) => feedback(e.message))
									: undefined}
								selected={selected?.id === item.id}
								checked={selectedIds.includes(String(item.id))}
								onCheck={(checked) =>
									(selectedIds = checked
										? [...selectedIds, String(item.id)]
										: selectedIds.filter((id) => id !== item.id))}
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
								{#if !query && view !== 'trash' && view !== 'archive'}<button
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
	</main>
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
					: newType === 'saved-search'
						? 'Save search'
						: `New ${newType}`}</Dialog.Title
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
	{collections}
	{saved}
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
				>Renaming preserves connections. Remove memberships before deleting an in-use tag or
				collection.</Dialog.Description
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
