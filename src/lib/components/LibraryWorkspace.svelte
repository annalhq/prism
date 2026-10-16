<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links use validated external HTTP URLs. App navigation uses resolve. */
	import { onMount } from 'svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import IconCaretDownFill from 'phosphor-icons-svelte/IconCaretDownFill.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Dialog, DropdownMenu } from 'bits-ui';
	import Brand from './ui/Brand.svelte';
	import SelectField from './ui/SelectField.svelte';
	import TokenInput from './ui/TokenInput.svelte';
	import BookmarkCard from './BookmarkCard.svelte';
	import { notePreview } from '#lib/client/reference-edits.js';
	import {
		ensureTag,
		inferBookmarkKind,
		isReadLater,
		personSlug,
		personIdFromSlug
	} from '#lib/client/workflows.js';
	import IconPlusFill from 'phosphor-icons-svelte/IconPlusFill.svelte';
	import IconMagnifyingGlassFill from 'phosphor-icons-svelte/IconMagnifyingGlassFill.svelte';
	import IconBookmarkSimpleFill from 'phosphor-icons-svelte/IconBookmarkSimpleFill.svelte';
	import IconUsersFill from 'phosphor-icons-svelte/IconUsersFill.svelte';
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
	import type { BookmarkCommand, Command, Revision } from '#lib/domain/contracts.js';
	import LibraryInspector from './LibraryInspector.svelte';
	import IconClockFill from 'phosphor-icons-svelte/IconClockFill.svelte';
	import IconPushPinFill from 'phosphor-icons-svelte/IconPushPinFill.svelte';
	import IconFolderFill from 'phosphor-icons-svelte/IconFolderFill.svelte';
	import IconHashFill from 'phosphor-icons-svelte/IconHashFill.svelte';
	import IconArchiveFill from 'phosphor-icons-svelte/IconArchiveFill.svelte';
	import IconTrashFill from 'phosphor-icons-svelte/IconTrashFill.svelte';
	import IconDotsThreeFill from 'phosphor-icons-svelte/IconDotsThreeFill.svelte';
	import IconUserCircleFill from 'phosphor-icons-svelte/IconUserCircleFill.svelte';
	import IconGearSixFill from 'phosphor-icons-svelte/IconGearSixFill.svelte';
	import IconXFill from 'phosphor-icons-svelte/IconXFill.svelte';
	let {
		openOffline = false,
		personSlug: profileSlug = ''
	}: { openOffline?: boolean; personSlug?: string } = $props();

	type Row = Record<string, unknown>;
	// The facade owns its mutable state and notifies via version; do not proxy its snapshots.
	let library = $state.raw<LibraryClient | null>(null),
		version = $state(0),
		sort = $state('newest'),
		toast = $state(''),
		creating = $state(false),
		busy = $state(false),
		formError = $state('');
	let newType = $state('bookmark'),
		newTitle = $state(''),
		newUrl = $state(''),
		newNote = $state(''),
		newTags = $state<string[]>([]),
		personUrl = $state(''),
		editingPerson = $state<Row | null>(null);
	let captureId = '',
		captureCreated = false,
		captureNoteSaved = false;
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
	let searchInput: HTMLInputElement | undefined = $state(),
		searcher: ReturnType<typeof createSearchClient> | undefined,
		generation = 0;
	const status = $derived.by(() => {
		void version;
		return library ? { ...library.state } : null;
	});
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
					all: 'All content',
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
		void version;
		const current = library,
			search = searcher;
		if (!current || !status?.ready || !search) return;
		const n = ++generation;
		const profile = personId;
		const connected = new Set(
			current
				.list<Row>('relationships')
				.filter((r) => !r.deletedAt && r.personId === profile)
				.map((r) => r.bookmarkId)
		);
		void search
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
		void client.start().then(() => {
			if (openOffline) return client.openCached().catch((error: Error) => feedback(error.message));
		});
		const key = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (target.closest('input,textarea,select,[contenteditable]') || event.isComposing) return;
			if (
				event.key === '/' ||
				((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
			) {
				event.preventDefault();
				searchInput?.focus();
			}
			if (
				event.key === 'Escape' &&
				!event.defaultPrevented &&
				!document.querySelector('[role=dialog],[role=menu],[role=listbox]')
			)
				void navigate(null);
		};
		window.addEventListener('keydown', key);
		return () => {
			client.stop();
			searcher?.stop();
			window.removeEventListener('keydown', key);
		};
	});
	function feedback(message: string) {
		toast = message;
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
		newType = type;
		newTags = [];
		personUrl = '';
		editingPerson = null;
		captureId = crypto.randomUUID();
		captureCreated = false;
		captureNoteSaved = false;
		newTitle = '';
		newUrl = '';
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
			if (!captureCreated) {
				const command: Command =
					newType === 'bookmark'
						? {
								type: 'bookmark.create',
								id,
								kind: inferBookmarkKind(newUrl),
								title: newTitle.trim() || newUrl,
								url: newUrl
							}
						: newType === 'person'
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
				if (result.status === 'already_exists') {
					formError =
						'This URL is already saved. Your note and tags are still here; open the existing bookmark to review them.';
					return;
				}
				captureCreated = true;
			}
			if (newType === 'bookmark') {
				if (newNote && !captureNoteSaved) {
					await library.setDraft(id, newNote, '0');
					const result = await library.save({
						type: 'note.replace',
						id,
						expectedRevision: '0',
						bodyMarkdown: newNote
					});
					if (result.status === 'rejected')
						throw new Error(result.message ?? 'Bookmark saved; note remains as a draft.');
					captureNoteSaved = true;
					if (result.status === 'accepted') await library.clearDraft(id);
				}
				for (const name of newTags) {
					const tagId = await ensureTag(library, name);
					if (((library.get<Row>('bookmarks', id)?.tagIds as string[]) ?? []).includes(tagId))
						continue;
					const result = await library.save({ type: 'tag.add', id, tagId });
					if (result.status === 'rejected')
						throw new Error(result.message ?? 'Could not save tag.');
				}
				if (personId) {
					const result = await library.save({
						type: 'content-person.add',
						bookmarkId: id,
						personId,
						role: 'related',
						provenance: 'manual'
					});
					if (result.status === 'rejected')
						throw new Error(result.message ?? 'Could not connect person.');
				}
			}
			creating = false;
			feedback(status?.online ? 'Saved.' : 'Saved on this device.');
			if (newType === 'person') await navigate({ kind: 'person', id });
			else if (newType !== 'bookmark')
				await navigate(null, `${newType === 'saved-search' ? 'saved' : newType}:${id}`);
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
<div class="v0-shell">
	<header class="v0-header">
		<Brand />
		<div class="global-search">
			<IconMagnifyingGlassFill /><input
				bind:this={searchInput}
				bind:value={query}
				aria-label="Search library"
				placeholder="Search anything in your library…"
				disabled={!status?.ready}
			/>
			<kbd>⌘ K</kbd>
		</div>
		<button
			class="primary-button new-button"
			disabled={!status?.ready || busy}
			onclick={() => create(view === 'people' ? 'person' : 'bookmark')}
			><IconPlusFill /><span>{view === 'people' ? 'Add person' : 'Add bookmark'}</span></button
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="account-button" aria-label="Account and library settings"
				><IconUserCircleFill /><IconCaretDownFill /></DropdownMenu.Trigger
			>
			<DropdownMenu.Portal
				><DropdownMenu.Content class="menu-content" sideOffset={8} align="end">
					<DropdownMenu.Group
						><DropdownMenu.GroupHeading class="menu-heading"
							>Your personal space</DropdownMenu.GroupHeading
						>
						<DropdownMenu.Item class="menu-item" onSelect={() => (settings = true)}
							><IconGearSixFill />Library settings</DropdownMenu.Item
						>
						<DropdownMenu.Item class="menu-item" onSelect={() => goto(resolve('/auth/sign-in'))}
							><IconUserCircleFill />Account & sign out</DropdownMenu.Item
						>
					</DropdownMenu.Group>
				</DropdownMenu.Content></DropdownMenu.Portal
			>
		</DropdownMenu.Root>
	</header>
	<div class:has-selection={!!selected} class="v0-workspace">
		<nav class="v0-sidebar" aria-label="Library navigation">
			<p class="section-label">Library</p>
			{#each [{ id: 'all', name: 'All content', icon: IconBookmarkSimpleFill }, { id: 'later', name: 'Read later', icon: IconClockFill }, { id: 'pinned', name: 'Pinned', icon: IconPushPinFill }, { id: 'people', name: 'People', icon: IconUsersFill }] as item (item.id)}<button
					class:active={view === item.id}
					class="nav-item"
					onclick={() => navigate(null, item.id)}
					aria-current={view === item.id ? 'page' : undefined}
					><item.icon /><span>{item.name}</span></button
				>{/each}
			<div class="sidebar-heading">
				<p class="section-label">Collections</p>
				<button
					class="text-button"
					aria-label="New collection"
					onclick={() => create('collection')}
					disabled={!status?.ready}><IconPlusFill /></button
				>
			</div>
			{#each collections as item (item.id)}<div class="sidebar-row">
					<button
						class:active={view === `collection:${item.id}`}
						class="nav-item"
						onclick={() => navigate(null, `collection:${item.id}`)}
						><IconFolderFill /><span>{item.name}</span></button
					><button
						aria-label={`Manage ${item.name}`}
						class="quiet-button"
						onclick={() => {
							manage = { table: 'collections', row: item };
							rename = String(item.name);
						}}><IconDotsThreeFill /></button
					>
				</div>{:else}<p class="sidebar-hint">A place for a focused reading list.</p>{/each}
			<div class="sidebar-heading">
				<p class="section-label">Tags</p>
				<button
					class="text-button"
					aria-label="New tag"
					onclick={() => create('tag')}
					disabled={!status?.ready}><IconPlusFill /></button
				>
			</div>
			{#each tags as item (item.id)}<div class="sidebar-row">
					<button
						class:active={view === `tag:${item.id}`}
						class="nav-item"
						onclick={() => navigate(null, `tag:${item.id}`)}
						><IconHashFill /><span>{item.name}</span></button
					><button
						aria-label={`Manage ${item.name}`}
						class="quiet-button"
						onclick={() => {
							manage = { table: 'tags', row: item };
							rename = String(item.name);
						}}><IconDotsThreeFill /></button
					>
				</div>{/each}
			{#if saved.length}<p class="section-label sidebar-heading">Saved searches</p>
				{#each saved as item (item.id)}<div class="sidebar-row">
						<button
							class="nav-item"
							class:active={view === `saved:${item.id}`}
							onclick={() => navigate(null, `saved:${item.id}`)}
							><IconMagnifyingGlassFill /><span>{item.name}</span></button
						><button
							aria-label={`Manage ${item.name}`}
							class="quiet-button"
							onclick={() => {
								manage = { table: 'savedSearches', row: item };
								rename = String(item.name);
							}}><IconDotsThreeFill /></button
						>
					</div>{/each}{/if}
			<div class="sidebar-bottom">
				<button
					class="nav-item"
					class:active={view === 'archive'}
					onclick={() => navigate(null, 'archive')}><IconArchiveFill /><span>Archive</span></button
				><button
					class="nav-item"
					class:active={view === 'trash'}
					onclick={() => navigate(null, 'trash')}><IconTrashFill /><span>Trash</span></button
				>
			</div>
		</nav>
		<main id="library-main" class="library-main" tabindex="-1">
			<div class="library-heading" class:person-heading={!!profileSlug}>
				<div>
					<p class="eyebrow">{profileSlug ? 'PEOPLE' : 'YOUR LIBRARY'}</p>
					<h1>{title}</h1>
					{#if person?.bio}<p class="person-bio">{person.bio}</p>{/if}{#if personWebsite}<a
							class="source-link"
							href={personWebsite}
							target="_blank"
							rel="noopener noreferrer">{personWebsite}</a
						>{/if}
				</div>
				{#if profileSlug && person}<button class="secondary-button" onclick={editPerson}
						>Edit profile</button
					>{:else if status?.ready}<SelectField
						label="Sort results"
						bind:value={sort}
						options={[
							{ value: 'newest', label: 'Newest first' },
							{ value: 'title', label: 'Title A–Z' },
							{ value: 'recently_opened', label: 'Recently opened' }
						]}
					/>{/if}
			</div>
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
					<div class="empty-icon"><IconBookmarkSimpleFill /></div>
					<h2>
						{status?.loading
							? 'Opening your library…'
							: 'Keep what matters. Connect what you learn.'}
					</h2>
					<p>
						A quiet home for saved content, your own notes, and the people and ideas around them.
					</p>
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
			{:else}
				<div class="list-toolbar">
					<span class="muted"
						>{results.items.length} {results.items.length === 1 ? 'item' : 'items'}</span
					>{#if query && !results.error}<button
							class="text-button"
							onclick={() => create('saved-search')}>Save search</button
						>{/if}<span class="toolbar-spacer"
					></span>{#if view === 'people' || view === 'personas'}<button
							class="text-button"
							onclick={() => create(view === 'people' ? 'person' : 'persona')}
							>+ Add {view === 'people' ? 'person' : 'persona'}</button
						>{/if}
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
				<div
					class="bookmark-list"
					class:person-timeline={!!profileSlug}
					onDisconnect={profileSlug
						? () => void disconnectContent(String(item.id)).catch((e) => feedback(e.message))
						: undefined}
				>
					{#if profileSlug && !person}<p class="panel-message">
							This person is unavailable.
						</p>{:else}
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
									note={notePreview(
										noteBodies.get(String(item.id)) ?? String(item.description ?? '')
									)}
									timeline={!!profileSlug}
									onDisconnect={profileSlug
										? () =>
												void disconnectContent(String(item.id)).catch((e) => feedback(e.message))
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
									<div class="empty-state-mark"><IconBookmarkSimpleFill /></div>
									<h2>
										{query
											? 'Nothing matched this search.'
											: view === 'people'
												? 'Keep the people behind the ideas.'
												: profileSlug
													? 'Their saved content appears here.'
													: 'Your next good idea belongs here.'}
									</h2>
									<p>
										{query
											? 'Try a title, note or #tag.'
											: profileSlug
												? 'Connect an existing bookmark above, or save a new one here.'
												: 'Save a link, add a thought, and come back to it anytime.'}
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
		{#if library && selected}{#key `${selected.kind}/${selected.id}`}<LibraryInspector
					{library}
					entity={selected}
					{version}
					navigate={(target) => void navigate(target)}
					{feedback}
					close={() => void navigate(null)}
				/>{/key}{/if}
	</div>
	<footer class="v0-status">
		<span class:offline={!status?.online}
			><span class="status-dot"></span>{status?.status ?? 'Connecting'}{status?.pending
				? ` · ${status.pending} pending`
				: ''}</span
		><span class="status-message" role="status" aria-live="polite"
			>{toast || status?.error || ''}</span
		>{#if status?.ready}<button
				class="text-button"
				onclick={() => library?.sync()}
				disabled={status.loading}>Refresh</button
			>{/if}
	</footer>
</div>

<Dialog.Root bind:open={creating}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content v0-dialog capture-dialog"
			><Dialog.Title class="dialog-title"
				>{newType === 'bookmark'
					? 'Save a bookmark'
					: newType === 'person'
						? editingPerson
							? 'Edit person'
							: 'Add person'
						: newType === 'saved-search'
							? 'Save search'
							: `New ${newType}`}</Dialog.Title
			><Dialog.Description class="sr-only"
				>{newType === 'bookmark'
					? 'Save a URL with an optional title, note and tags. Press Enter to save.'
					: 'Add a name and optional details.'}</Dialog.Description
			>
			<form class="stack capture-form" onsubmit={submitCreate}>
				<fieldset disabled={busy}>
					{#if newType === 'bookmark'}<label for="capture-url" class="sr-only">URL</label><input
							id="capture-url"
							type="url"
							bind:value={newUrl}
							required
							placeholder="Paste a URL…"
						/>{/if}
					<label for="capture-title" class="sr-only"
						>{newType === 'bookmark' ? 'Title' : 'Name'}</label
					><input
						id="capture-title"
						bind:value={newTitle}
						required={newType !== 'bookmark'}
						maxlength={newType === 'person' ? 200 : newType === 'bookmark' ? 500 : 64}
						placeholder={newType === 'bookmark'
							? 'Title (optional)'
							: newType === 'person'
								? 'Full name'
								: 'Name'}
					/>
					{#if newType === 'person'}<label for="person-url" class="sr-only">Profile URL</label
						><input
							id="person-url"
							type="url"
							bind:value={personUrl}
							placeholder="Twitter / website URL (optional)"
						/>{/if}
					{#if newType === 'bookmark' || newType === 'person'}<label
							for="capture-note"
							class="sr-only">{newType === 'person' ? 'About' : 'Note'}</label
						><textarea
							id="capture-note"
							bind:value={newNote}
							rows="2"
							placeholder={newType === 'person'
								? 'About this person (optional)'
								: 'A note to yourself (optional)'}
							onkeydown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
									e.preventDefault();
									e.currentTarget.form?.requestSubmit();
								}
							}}></textarea>{/if}
					{#if newType === 'bookmark'}<TokenInput
							label="Bookmark tags"
							placeholder="#tags, separated by commas"
							allowCreate
							items={[...new Set([...tags.map((t) => String(t.name)), ...newTags])].map((name) => ({
								value: name,
								label: name
							}))}
							selected={newTags}
							onAdd={(value) => {
								if (!newTags.includes(value)) newTags = [...newTags, value];
							}}
							onRemove={(value) => {
								newTags = newTags.filter((n) => n !== value);
							}}
						/>{/if}
					{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
					<div class="capture-footer">
						<span class="muted">Enter to save · Shift + Enter for a new line</span><button
							type="submit"
							class="primary-button"
							disabled={busy}>{busy ? 'Saving…' : 'Save'}</button
						>
					</div>
				</fieldset>
			</form>
			<Dialog.Close
				class="icon-button dialog-close"
				disabled={busy}
				aria-label="Close creation form"><IconXFill /></Dialog.Close
			>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root bind:open={settings}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content v0-dialog"
			><Dialog.Title class="dialog-title">Your library</Dialog.Title><Dialog.Description
				class="dialog-description"
				>Metadata and drafts stay private to this vault. This v0 supports local work and
				synchronization; provider media and full backups follow later.</Dialog.Description
			>
			<div class="stack">
				<div class="button-row">
					<button
						onclick={() => {
							settings = false;
							create('tag');
						}}>New tag</button
					><button
						onclick={() => {
							settings = false;
							create('collection');
						}}>New collection</button
					>
				</div>
				<button onclick={exportData} disabled={!status?.ready}>Export library metadata</button
				><label class="file-input"
					>Import a Prism metadata export<input
						type="file"
						accept="application/json,.json"
						onchange={pickImport}
						disabled={!status?.ready}
					/></label
				><button
					onclick={async () => {
						if (library) download(await library.exportPending(), 'prism-pending-work.json');
					}}>Export pending work and drafts</button
				><button onclick={runMaintenance} disabled={!status?.online || !status?.ready}
					>Run pending profile cleanup</button
				>
				<p class="muted">
					Use this browser on a trusted device. Cached library data is not end-to-end encrypted.
				</p>
				<p class="muted">
					Search: text, "phrases", #tag, @collection, person:"Name", is:page, is:person, is:trash,
					site:example.com, and has:note.
				</p>
			</div>
			<p role="status">{toast || status?.error || ''}</p>
			{#if status?.conflicts.length}<h3>Needs attention</h3>
				{#each status.conflicts as conflict (conflict.operationId)}<div class="conflict-entry">
						<strong>{conflict.envelope.command.type}</strong>
						<p>{conflict.error?.message}</p>
						<p class="muted">
							Your original change and note draft are preserved. Open the item to review its current
							data.
						</p>
						<button
							onclick={() =>
								library
									?.resolveConflict(conflict.operationId, 'remote')
									.catch((error: Error) => feedback(error.message))}
							>Keep server version; preserve draft</button
						>
					</div>{/each}{/if}<Dialog.Close
				class="icon-button dialog-close"
				aria-label="Close library settings"><IconXFill /></Dialog.Close
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
				disabled={busy}><IconXFill /></Dialog.Close
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
				><IconXFill /></Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
