<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Dialog } from 'bits-ui';
	import IconPlusRegular from 'phosphor-icons-svelte/IconPlusRegular.svelte';
	import IconMagnifyingGlassRegular from 'phosphor-icons-svelte/IconMagnifyingGlassRegular.svelte';
	import IconTrayRegular from 'phosphor-icons-svelte/IconTrayRegular.svelte';
	import IconBookmarkSimpleRegular from 'phosphor-icons-svelte/IconBookmarkSimpleRegular.svelte';
	import IconUsersRegular from 'phosphor-icons-svelte/IconUsersRegular.svelte';
	import IconSquaresFourRegular from 'phosphor-icons-svelte/IconSquaresFourRegular.svelte';
	import { createLibraryClient, type LibraryClient } from '#lib/client/vault/library.js';
	import { createSearchClient } from '#lib/client/search-client.js';
	import { entityLabel, emptySearch, type searchLibrary } from '#lib/client/search.js';
	import {
		exportLibrary,
		previewImport,
		importLibrary,
		type ImportResult
	} from '#lib/client/vault/portability.js';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { BookmarkCommand, Command, Revision } from '#lib/domain/contracts.js';
	import LibraryInspector from './LibraryInspector.svelte';

	type Row = Record<string, unknown>;
	let library = $state<LibraryClient | null>(null),
		version = $state(0),
		sort = $state('newest'),
		toast = $state(''),
		creating = $state(false),
		busy = $state(false),
		formError = $state('');
	let newType = $state('bookmark'),
		newTitle = $state(''),
		newUrl = $state(''),
		newKind = $state<'page' | 'social' | 'image'>('page'),
		newNote = $state('');
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
	const view = $derived(page.url.searchParams.get('view') ?? 'all');
	const selected = $derived.by(() => {
		const id = page.url.searchParams.get('item'),
			kind = page.url.searchParams.get('kind');
		return id && (kind === 'bookmark' || kind === 'person' || kind === 'persona')
			? ({ id, kind } as EntityRef)
			: null;
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
		(
			{
				all: 'All content',
				inbox: 'Inbox',
				later: 'Read later',
				pinned: 'Pinned',
				archive: 'Archive',
				trash: 'Trash',
				people: 'People',
				personas: 'Personas'
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
		void search
			.query(current, view, query, sort)
			.then((value) => {
				if (n === generation) results = value;
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
		void client.start();
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
			if (event.key === 'Escape') void navigate(null);
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
		const url = new URL(page.url.href);
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
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- The URL is cloned from the current app page, including its configured base.
		await goto(url, { reset: false });
	}
	function create(type: string) {
		newType = type;
		newTitle = '';
		newUrl = '';
		newNote = '';
		formError = '';
		creating = true;
	}
	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		if (!library) return;
		busy = true;
		formError = '';
		const id = crypto.randomUUID();
		let command: Command;
		if (newType === 'bookmark')
			command = {
				type: 'bookmark.create',
				id,
				kind: newKind,
				title: newTitle.trim() || newUrl,
				url: newUrl || null
			};
		else if (newType === 'person') command = { type: 'person.create', id, displayName: newTitle };
		else if (newType === 'persona') command = { type: 'persona.create', id, name: newTitle };
		else if (newType === 'saved-search')
			command = {
				type: 'saved-search.create',
				id,
				name: newTitle,
				filter: results.filter,
				sort: sort as 'newest'
			};
		else command = { type: `${newType}.create`, id, name: newTitle } as Command;
		try {
			const result = await library.save(command);
			if (result.status === 'rejected') {
				formError = result.message ?? 'Could not save.';
				return;
			}
			if (result.status === 'already_exists') {
				feedback('This URL is already saved. Its content was kept.');
				if (result.existingId) await navigate({ kind: 'bookmark', id: result.existingId });
				if (newNote) {
					formError =
						'This item already exists. Your capture note is still here; copy it before closing.';
					return;
				}
				creating = false;
				return;
			}
			if (newType === 'bookmark' && newNote) {
				await library.setDraft(id, newNote, '0');
				if (result.status === 'accepted') {
					const note = await library.save({
						type: 'note.replace',
						id,
						expectedRevision: '0',
						bodyMarkdown: newNote
					});
					if (note.status === 'accepted') await library.clearDraft(id);
				}
			}
			creating = false;
			feedback(result.message ?? 'Saved.');
			if (newType === 'bookmark' || newType === 'person' || newType === 'persona')
				await navigate({ kind: newType, id });
			else await navigate(null, `${newType === 'saved-search' ? 'saved' : newType}:${id}`);
		} catch (e) {
			formError = (e as Error).message;
		} finally {
			busy = false;
		}
	}
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

<a class="skip-link" href="#library-main">Skip to content</a>
<div class="v0-shell">
	<header class="v0-header">
		<a class="brand" href={resolve('/')}
			><span class="brand-symbol" aria-hidden="true">P</span><span
				>Prism<span class="brand-caption">Your private library</span></span
			></a
		>
		<div class="global-search">
			<IconMagnifyingGlassRegular /><input
				bind:this={searchInput}
				bind:value={query}
				aria-label="Search library"
				placeholder="Search your library…   /"
				disabled={!status?.ready}
			/>
		</div>
		<button
			class="primary-button new-button"
			onclick={() =>
				create(view === 'people' ? 'person' : view === 'personas' ? 'persona' : 'bookmark')}
			disabled={!status?.ready}><IconPlusRegular /><span>New</span></button
		><a class="account-link" href={resolve('/auth/sign-in')}>Account</a><button
			class="icon-button"
			aria-label="Library settings"
			onclick={() => (settings = true)}>⋯</button
		>
	</header>
	<div class:has-selection={!!selected} class="v0-workspace">
		<nav class="v0-sidebar" aria-label="Library navigation">
			<p class="section-label">Library</p>
			{#each [{ id: 'inbox', name: 'Inbox', icon: IconTrayRegular }, { id: 'all', name: 'All content', icon: IconBookmarkSimpleRegular }, { id: 'later', name: 'Read later', icon: IconBookmarkSimpleRegular }, { id: 'pinned', name: 'Pinned', icon: IconBookmarkSimpleRegular }, { id: 'people', name: 'People', icon: IconUsersRegular }, { id: 'personas', name: 'Personas', icon: IconSquaresFourRegular }] as item (item.id)}<button
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
					disabled={!status?.ready}>+</button
				>
			</div>
			{#each collections as item (item.id)}<div class="sidebar-row">
					<button
						class:active={view === `collection:${item.id}`}
						class="nav-item"
						onclick={() => navigate(null, `collection:${item.id}`)}>{item.name}</button
					><button
						aria-label={`Manage ${item.name}`}
						class="quiet-button"
						onclick={() => {
							manage = { table: 'collections', row: item };
							rename = String(item.name);
						}}>⋯</button
					>
				</div>{:else}<p class="sidebar-hint">A place for a focused reading list.</p>{/each}
			<div class="sidebar-heading">
				<p class="section-label">Tags</p>
				<button
					class="text-button"
					aria-label="New tag"
					onclick={() => create('tag')}
					disabled={!status?.ready}>+</button
				>
			</div>
			{#each tags as item (item.id)}<div class="sidebar-row">
					<button
						class:active={view === `tag:${item.id}`}
						class="nav-item"
						onclick={() => navigate(null, `tag:${item.id}`)}># {item.name}</button
					><button
						aria-label={`Manage ${item.name}`}
						class="quiet-button"
						onclick={() => {
							manage = { table: 'tags', row: item };
							rename = String(item.name);
						}}>⋯</button
					>
				</div>{/each}
			{#if saved.length}<p class="section-label sidebar-heading">Saved searches</p>
				{#each saved as item (item.id)}<div class="sidebar-row">
						<button
							class="nav-item"
							class:active={view === `saved:${item.id}`}
							onclick={() => navigate(null, `saved:${item.id}`)}>{item.name}</button
						><button
							aria-label={`Manage ${item.name}`}
							class="quiet-button"
							onclick={() => {
								manage = { table: 'savedSearches', row: item };
								rename = String(item.name);
							}}>⋯</button
						>
					</div>{/each}{/if}
			<div class="sidebar-bottom">
				<button
					class="nav-item"
					class:active={view === 'archive'}
					onclick={() => navigate(null, 'archive')}>Archive</button
				><button
					class="nav-item"
					class:active={view === 'trash'}
					onclick={() => navigate(null, 'trash')}>Trash</button
				>
			</div>
		</nav>
		<main id="library-main" class="library-main" tabindex="-1">
			<div class="library-heading">
				<div>
					<p class="eyebrow">Your knowledge, connected</p>
					<h1>{title}</h1>
				</div>
				{#if status?.ready}<select aria-label="Sort results" bind:value={sort}
						><option value="newest">Newest first</option><option value="title">Title</option><option
							value="recently_opened">Recently opened</option
						></select
					>{/if}
			</div>
			{#if !status?.ready}<section class="welcome-panel">
					<div class="empty-icon"><IconBookmarkSimpleRegular /></div>
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
						<strong>{selectedIds.length} selected</strong><select
							aria-label="Bulk tag"
							bind:value={bulkTag}
							><option value="">Tag…</option>{#each tags as tag (tag.id)}<option
									value={String(tag.id)}>{tag.name}</option
								>{/each}</select
						><button onclick={() => bulk('tag')} disabled={!bulkTag || busy}>Add tag</button><select
							aria-label="Bulk collection"
							bind:value={bulkCollection}
							><option value="">Inbox</option>{#each collections as c (c.id)}<option
									value={String(c.id)}>{c.name}</option
								>{/each}</select
						><button onclick={() => bulk('collection')} disabled={busy}>Move</button><button
							onclick={() => bulk('archive')}
							disabled={busy}>Archive</button
						><button onclick={() => bulk('trash')} disabled={busy}>Trash</button>
					</div>{/if}
				<div class="bookmark-list">
					{#each results.items.slice(0, limit) as item (String(item.id))}<div
							class:selected={selected?.id === item.id}
							class="library-row"
						>
							{#if item.entityKind === 'bookmark' && view !== 'trash'}<input
									class="row-checkbox"
									type="checkbox"
									aria-label={`Select ${entityLabel(item)}`}
									checked={selectedIds.includes(String(item.id))}
									onchange={(e) =>
										(selectedIds = e.currentTarget.checked
											? [...selectedIds, String(item.id)]
											: selectedIds.filter((id) => id !== item.id))}
								/>{/if}<button
								class="library-row-body"
								onclick={() => navigate({ kind: item.entityKind, id: String(item.id) })}
								><span class="row-kind"
									>{item.entityKind === 'bookmark' ? item.kind : item.entityKind}</span
								><span class="row-title">{item.isPinned ? '✦ ' : ''}{entityLabel(item)}</span><span
									class="row-description"
									>{String(item.description ?? item.bio ?? '').slice(0, 180) ||
										String(item.domain ?? '')}</span
								><span class="row-meta"
									>{item.domain ??
										(item.entityKind === 'persona'
											? 'Knowledge context'
											: item.entityKind === 'person'
												? 'Profile'
												: '')}{item.readingStatus && item.entityKind === 'bookmark'
										? ` · ${item.readingStatus}`
										: ''}</span
								></button
							><span class="row-date"
								>{new Date(String(item.createdAt)).toLocaleDateString(undefined, {
									month: 'short',
									day: 'numeric'
								})}</span
							>
						</div>{:else}{#if !results.error}<section class="welcome-panel compact">
								<h2>
									{query
										? 'Nothing matched this search.'
										: 'A little room for your next discovery.'}
								</h2>
								<p>
									{query
										? 'Try a title, a phrase, #tag, person:"Name" or site:example.com.'
										: view === 'people'
											? 'Add a person, then connect their saved work.'
											: view === 'personas'
												? 'Create a context and bring relevant people and content together.'
												: 'Save something you want to remember, then make it your own with notes.'}
								</p>
								{#if !query && view !== 'trash' && view !== 'archive'}<button
										class="primary-button"
										onclick={() =>
											create(
												view === 'people' ? 'person' : view === 'personas' ? 'persona' : 'bookmark'
											)}
										>Add your first {view === 'people'
											? 'person'
											: view === 'personas'
												? 'persona'
												: 'item'}</button
									>{/if}
							</section>{/if}{/each}
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
			>{toast || status?.error || 'A personal space for everything you learn.'}</span
		>{#if status?.ready}<button
				class="text-button"
				onclick={() => library?.sync()}
				disabled={status.loading}>Refresh</button
			>{/if}
	</footer>
</div>

<Dialog.Root bind:open={creating}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content v0-dialog"
			><Dialog.Title class="dialog-title"
				>{newType === 'saved-search'
					? 'Save this search'
					: `New ${newType === 'bookmark' ? 'saved content' : newType}`}</Dialog.Title
			><Dialog.Description class="dialog-description"
				>{newType === 'persona'
					? 'A named context for relevant people and saved content.'
					: newType === 'person'
						? 'A real person. Names can be shared; connections stay distinct.'
						: 'Give it a place in your library.'}</Dialog.Description
			>
			<form class="stack" onsubmit={submitCreate}>
				{#if newType === 'bookmark'}<label for="capture-kind">Type</label><select
						id="capture-kind"
						bind:value={newKind}
						><option value="page">Web page</option><option value="social">Social post</option
						><option value="image">Image reference</option></select
					><label for="capture-url">Source URL {newKind === 'image' ? '(optional)' : ''}</label
					><input
						id="capture-url"
						type="url"
						bind:value={newUrl}
						required={newKind !== 'image'}
						placeholder="https://…"
					/>{/if}<label for="capture-title">{newType === 'bookmark' ? 'Title' : 'Name'}</label
				><input
					id="capture-title"
					bind:value={newTitle}
					required={newType !== 'bookmark' || !newUrl}
					maxlength={newType === 'bookmark' ? 500 : newType === 'person' ? 200 : 64}
					placeholder={newType === 'persona'
						? 'Systems Engineering'
						: 'Something worth remembering'}
				/>{#if newType === 'bookmark'}<label for="capture-note">Note (optional)</label><textarea
						id="capture-note"
						bind:value={newNote}
						rows="4"
						placeholder="Why is this worth keeping?"></textarea>{/if}{#if formError}<p
						class="form-error"
						role="alert"
					>
						{formError}
					</p>{/if}<button type="submit" class="primary-button" disabled={busy}
					>{busy ? 'Saving…' : 'Save'}</button
				>
			</form>
			<Dialog.Close class="icon-button dialog-close" aria-label="Close creation form"
				>×</Dialog.Close
			></Dialog.Content
		></Dialog.Portal
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
					Search: text, "phrases", #tag, @collection, person:"Name", author:"Name", persona:"Name",
					is:page, is:person, is:trash, site:example.com, has:note and status:unread.
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
				aria-label="Close library settings">×</Dialog.Close
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
				disabled={busy}>×</Dialog.Close
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
			<Dialog.Close class="icon-button dialog-close" aria-label="Close management">×</Dialog.Close
			></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
