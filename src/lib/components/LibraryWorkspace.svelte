<script lang="ts">
	import {
		Bookmark as BookmarkIcon,
		ChevronDown as ChevronDownIcon,
		X as XIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links use validated external HTTP URLs. App navigation uses resolve. */
	import { onMount, tick } from 'svelte';
	import { UserRound, Keyboard } from '@lucide/svelte';
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
	import Brand from './ui/Brand.svelte';
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
	import type { BookmarkCommand, Command, Revision } from '#lib/domain/contracts.js';
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
		busy = $state(false),
		formError = $state('');
	let newType = $state('person'),
		newTitle = $state(''),
		newNote = $state(''),
		personUrl = $state(''),
		editingPerson = $state<Row | null>(null);
	let captureId = '';
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
	let query = $derived(page.url.searchParams.get('q') ?? '');
	$effect(() => {
		void contentVersion;
		const current = library,
			search = searcher;
		if (!current || !libraryReady || !search) return;
		const n = ++generation;
		const profile = personId;
		const connected = new Set(
			current
				.list<Row>('relationships')
				.filter((r) => !r.deletedAt && r.personId === profile)
				.map((r) => r.bookmarkId)
		);
		pendingResults = search
			.query(current, view, query, sort)
			.then((value) => {
				if (n === generation)
					results = profileSlug
						? {
								...value,
								items: value.items.filter((i) => i.entityKind === 'bookmark' && connected.has(i.id))
							}
						: value;
			})
			.catch((e) => {
				if (n === generation) toast = (e as Error).message;
			});
	});
	onMount(() => {
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
		if (busy) return;
		if (type === 'bookmark') {
			void omnibar?.focusInsert();
			return;
		}
		newType = type;
		personUrl = '';
		editingPerson = null;
		captureId = crypto.randomUUID();
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
	}
	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		if (!library || busy) return;
		busy = true;
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
								patch: { displayName: newTitle, website: personUrl || null, bio: newNote }
							}
						: {
								type: 'person.create',
								id,
								displayName: newTitle,
								website: personUrl || null,
								bio: newNote
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
			feedback(status?.online ? 'Saved.' : 'Saved on this device.');
			if (newType === 'person') await navigate({ kind: 'person', id });
			else await navigate(null, `${newType === 'saved-search' ? 'saved' : newType}:${id}`);
		} catch (e) {
			formError = (e as Error).message;
		} finally {
			busy = false;
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
		const result = await library.save(command);
		feedback(result.message ?? 'Saved.');
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

	async function bulk(action: 'tag' | 'collection' | 'archive' | 'trash') {
		if (!library) return;
		busy = true;
		let completed = 0;
		try {
			for (let offset = 0; offset < selectedIds.length; offset += 100) {
				const commands = selectedIds.slice(offset, offset + 100).map((id) => {
					const row = library!.get<Row>('bookmarks', id);
					if (!row || row.deletedAt)
						throw new Error(
							'A selected item is unavailable. Refresh the list and select it again.'
						);
					return action === 'tag'
						? { type: 'tag.add', id, tagId: bulkTag }
						: {
								type: action === 'trash' ? 'bookmark.trash' : 'bookmark.organize',
								id,
								expectedRevision: String(row.revision) as Revision,
								...(action === 'trash'
									? {}
									: {
											patch:
												action === 'archive'
													? { isArchived: true }
													: { collectionId: bulkCollection || null }
										})
							};
				});
				const result = await library.save({
					type: 'bookmark.bulk',
					commands: commands as BookmarkCommand[]
				});
				if (result.status === 'rejected') {
					feedback(`${completed} items processed. ${result.message}`);
					return;
				}
				completed += commands.length;
			}
			feedback(`${completed} items saved${status?.online ? '' : ' on this device'}.`);
			selectedIds = [];
		} catch (error) {
			feedback(
				`${completed} items processed. ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			busy = false;
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
		busy = true;
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
			busy = false;
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
<div class="library-shell">
	<header class="library-header">
		<Brand compact />
		<span class="header-divider" aria-hidden="true">/</span>
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
			onclick={() => (settings = true)}><span class="account-avatar"><UserRound /></span></button
		>
	</header>
	<main id="library-main" class="library-main" tabindex="-1">
		<h1 class="sr-only">{title}</h1>
		<Omnibar
			bind:this={omnibar}
			{library}
			ready={!!status?.ready}
			{tags}
			{people}
			bind:query
			{personId}
			{feedback}
			onNormal={focusLibrary}
		/>
		{#if profileSlug && person}<div class="person-profile">
				<div>
					<h2>{person.displayName}</h2>
					{#if person.bio}<p class="person-bio">{person.bio}</p>{/if}{#if personWebsite}<a
							class="source-link"
							href={personWebsite}
							target="_blank"
							rel="noopener noreferrer">{personWebsite}</a
						>{/if}
				</div>
				<button class="text-button" onclick={editPerson}>Edit profile</button>
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
					<strong>{selectedIds.length} selected</strong><TokenInput
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
					<SelectField
						label="Bulk collection"
						bind:value={bulkCollection}
						options={[
							{ value: '', label: 'No collection' },
							...collections.map((r) => ({ value: String(r.id), label: String(r.name) }))
						]}
					/><button onclick={() => bulk('collection')} disabled={busy}>Move</button><button
						onclick={() => bulk('archive')}
						disabled={busy}>Archive</button
					><button onclick={() => bulk('trash')} disabled={busy}>Trash</button>
				</div>{/if}
			<div class="bookmark-list" class:person-timeline={!!profileSlug}>
				{#if profileSlug && !person}<p class="panel-message">This person is unavailable.</p>{:else}
					{#each results.items.slice(0, limit) as item (String(item.id))}
						{#if item.entityKind === 'person'}<button
								class="person-card"
								onclick={() => navigate({ kind: 'person', id: String(item.id) })}
								><span class="person-initial">{String(item.displayName).slice(0, 1)}</span><span
									><strong>{item.displayName}</strong><small
										>{item.bio || item.website || 'Open profile'}</small
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
								onDisconnect={profileSlug
									? () => void disconnectContent(String(item.id)).catch((e) => feedback(e.message))
									: undefined}
								selected={selected?.id === item.id}
								checked={selectedIds.includes(String(item.id))}
								onCheck={profileSlug
									? undefined
									: (checked) =>
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
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content editor-dialog"
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				document
					.querySelector<HTMLElement>(`[data-bookmark-id="${editorReturnId}"] .bookmark-title`)
					?.focus();
			}}
		>
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
				<fieldset disabled={busy}>
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
					<button type="submit" class="primary-button" disabled={busy}
						>{busy ? 'Saving…' : 'Save'}</button
					>
				</fieldset>
			</form>
			<Dialog.Close
				class="icon-button dialog-close"
				disabled={busy}
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
					disabled={busy ||
						!importPreview.valid ||
						!!importReport ||
						!status?.online ||
						!!status?.pending}>{busy ? 'Importing…' : 'Import copy'}</button
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
				disabled={busy}><XIcon /></Dialog.Close
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
