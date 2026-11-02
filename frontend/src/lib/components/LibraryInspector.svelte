<script lang="ts">
	import {
		X as XIcon,
		ArrowUpRight as ArrowUpRightIcon,
		Clock3 as Clock3Icon,
		Ellipsis as EllipsisIcon,
		Hash as HashIcon,
		Pencil as PencilIcon,
		RotateCcw as RotateCcwIcon,
		Trash2 as Trash2Icon,
		Users as UsersIcon,
		CornerDownRight as BacklinkIcon,
		NotebookText as NoteIcon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links are validated external HTTP URLs. */
	import { onMount, onDestroy } from 'svelte';
	import { cue } from '#lib/client/sounds.svelte.js';
	import { AlertDialog, DropdownMenu } from 'bits-ui';
	import { autosize } from '#lib/client/attachments.js';
	import Favicon from './ui/Favicon.svelte';
	import PersonAvatar from './ui/PersonAvatar.svelte';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { Command, Revision } from '#lib/domain/contracts.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { extractReferences } from '#lib/domain/notes.js';
	import { entityLabel } from '#lib/client/search.js';
	import { ensureTag, isReadLater, type Row } from '#lib/client/workflows.js';
	import NoteEditor from './NoteEditor.svelte';
	import TokenInput from './ui/TokenInput.svelte';
	let {
		library,
		entity,
		version,
		navigate,
		feedback,
		close
	}: {
		library: LibraryClient;
		entity: EntityRef;
		version: number;
		navigate: (target: EntityRef) => void;
		feedback: (message: string) => void;
		close: () => void;
	} = $props();
	let title = $state(''),
		url = $state(''),
		base = $state<Revision>('0'),
		dirty = $state(false),
		busy = $state(false),
		error = $state(''),
		purgeOpen = $state(false),
		editingSource = $state(false);
	let draftWrites = Promise.resolve();
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	const draftId = $derived(`bookmark-details:${entity.id}`);
	onMount(() => {
		const draft = library.getDraft(draftId);
		if (!draft) return;
		try {
			const value = JSON.parse(draft.body);
			if (typeof value.title === 'string' && typeof value.url === 'string') {
				title = value.title;
				url = value.url;
				base = draft.baseRevision;
				dirty = true;
			}
		} catch {
			error = 'A saved details draft could not be opened. It remains in your pending-work export.';
		}
	});
	function persistDetails() {
		const body = JSON.stringify({ title, url }),
			revision = base;
		draftWrites = draftWrites
			.then(() => library.setDraft(draftId, body, revision))
			.catch((e) => {
				error = e.message;
			});
	}
	function edited(field: 'title' | 'url', value: string) {
		if (field === 'title') title = value;
		else url = value;
		dirty = true;
		clearTimeout(draftTimer);
		draftTimer = setTimeout(persistDetails, 200);
	}
	onDestroy(() => {
		clearTimeout(draftTimer);
		if (dirty) persistDetails();
	});
	const row = $derived.by(() => {
		void version;
		return library.get<Row>('bookmarks', entity.id);
	});
	const tags = $derived.by(() => {
		void version;
		return library.list<Row>('tags').filter((t) => !t.deletedAt);
	});
	const people = $derived.by(() => {
		void version;
		return library.list<Row>('people').filter((p) => !p.deletedAt && !p.purgedAt);
	});
	const relationships = $derived.by(() => {
		void version;
		return library
			.list<Row>('relationships')
			.filter((r) => !r.deletedAt && r.bookmarkId === entity.id);
	});
	const linkedPeople = $derived([...new Set(relationships.map((r) => String(r.personId)))]);
	const incoming = $derived.by(() => {
		void version;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Rebuilt whole on every derivation.
		const ids = new Set(
			library
				.list<Row>('notes')
				.filter(
					(n) =>
						n.entityId !== entity.id &&
						extractReferences(String(n.bodyMarkdown)).some((r) => r.id === entity.id)
				)
				.map((n) => String(n.entityId))
		);
		for (const l of library.list<Row>('links'))
			if (
				l.sourceId !== entity.id &&
				((l.edges as { targetId: string }[]) ?? []).some((e) => e.targetId === entity.id)
			)
				ids.add(String(l.sourceId));
		const all: (Row & { entityKind: 'bookmark' | 'person' })[] = [
			...library.list<Row>('bookmarks').map((r) => ({ ...r, entityKind: 'bookmark' as const })),
			...people.map((r) => ({ ...r, entityKind: 'person' as const }))
		];
		return all.filter((r) => ids.has(String(r.id)) && !r.deletedAt && !r.purgedAt);
	});
	$effect(() => {
		if (row && !dirty) {
			title = String(row.title);
			url = String(row.url ?? '');
			base = String(row.revision) as Revision;
		}
	});
	const safeSource = $derived.by(() => {
		try {
			return normalizeUrl(url).url;
		} catch {
			return null;
		}
	});
	async function act(command: Command) {
		const result = await library.save(command);
		if (result.status === 'rejected') {
			cue('error');
			throw new Error(result.message ?? 'Could not save this change.');
		}
	}
	async function details() {
		if (!dirty || busy || !row || row.deletedAt) return;
		busy = true;
		error = '';
		persistDetails();
		const sentTitle = title,
			sentUrl = url;
		try {
			await act({
				type: 'bookmark.update',
				id: entity.id,
				expectedRevision: base,
				patch: { title: sentTitle, url: sentUrl || null }
			});
			base = String(library.get<Row>('bookmarks', entity.id)?.revision ?? base) as Revision;
			if (title === sentTitle && url === sentUrl) {
				dirty = false;
				clearTimeout(draftTimer);
				draftWrites = draftWrites
					.then(() => library.clearDraft(draftId))
					.catch((e) => {
						error = e.message;
					});
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
	async function organize(patch: { readingStatus?: 'unread' | 'reading' }) {
		try {
			await act({
				type: 'bookmark.organize',
				id: entity.id,
				expectedRevision: String(
					library.get<Row>('bookmarks', entity.id)?.revision ?? '0'
				) as Revision,
				patch
			});
		} catch (e) {
			error = (e as Error).message;
		}
	}
	async function lifecycle(action: 'restore' | 'purge') {
		try {
			await act({
				type: `bookmark.${action}`,
				id: entity.id,
				expectedRevision: String(row?.revision ?? '0') as Revision
			});
			if (action === 'purge') close();
		} catch (e) {
			error = (e as Error).message;
		}
	}
	async function addTag(value: string, create: boolean) {
		const tagId = create ? await ensureTag(library, value) : value;
		await act({ type: 'tag.add', id: entity.id, tagId });
	}
	async function moveToTrash() {
		try {
			await act({
				type: 'bookmark.trash',
				id: entity.id,
				expectedRevision: String(row?.revision ?? '0') as Revision
			});
			close();
		} catch (e) {
			error = (e as Error).message;
		}
	}
	const host = $derived(safeSource ? new URL(safeSource).hostname.replace(/^www\./, '') : '');
	// A written note saved on its own: no link to show or edit, and its body reads rendered.
	const textItem = $derived(row?.kind === 'text');
	async function removePerson(id: string) {
		for (const r of relationships.filter((r) => r.personId === id))
			await act({
				type: 'content-person.remove',
				bookmarkId: entity.id,
				personId: id,
				role: r.role as 'related'
			});
	}
</script>

<aside class="library-inspector simple-editor" aria-label="Edit bookmark">
	<header class="editor-bar">
		{#if editingSource && row && !row.deletedAt}<input
				class="editor-source-input"
				type="url"
				aria-label="Source URL"
				placeholder="https://"
				bind:value={url}
				oninput={(e) => edited('url', e.currentTarget.value)}
				onblur={() => {
					editingSource = false;
					void details();
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === 'Escape') {
						e.preventDefault();
						e.stopPropagation();
						e.currentTarget.blur();
					}
				}}
				{@attach (node) => {
					// Focus once the menu that opened it has finished closing; select the URL so it
					// can be replaced or edited straight away.
					const frame = requestAnimationFrame(() => {
						node.focus();
						node.select();
					});
					return () => cancelAnimationFrame(frame);
				}}
			/>{:else if safeSource}<a
				class="editor-source"
				href={safeSource}
				target="_blank"
				rel="noopener noreferrer"
				title={safeSource}
				onclick={() => void library.save({ type: 'activity.open', id: entity.id })}
				><Favicon url={safeSource} /><span>{host}</span><ArrowUpRightIcon /></a
			>{:else if textItem}<span class="editor-source muted"><NoteIcon /><span>Note</span></span
			>{:else}<span class="editor-source muted">No link</span>{/if}
		<span class="editor-bar-actions">
			{#if row && !row.deletedAt}<button
					class={['icon-button', 'editor-later', isReadLater(row) && 'on']}
					aria-pressed={isReadLater(row)}
					aria-label={isReadLater(row) ? 'Remove from Read later' : 'Read later'}
					title={isReadLater(row) ? 'In Read later' : 'Read later'}
					onclick={() => organize({ readingStatus: isReadLater(row) ? 'unread' : 'reading' })}
					><Clock3Icon /></button
				><DropdownMenu.Root
					><DropdownMenu.Trigger class="icon-button" aria-label="More actions"
						><EllipsisIcon /></DropdownMenu.Trigger
					><DropdownMenu.Portal
						><DropdownMenu.Content
							class="menu-content"
							align="end"
							sideOffset={6}
							onCloseAutoFocus={(event) => {
								// Closing would hand focus back to the trigger, blurring the link field that
								// "Edit link" just opened, and blurring it ends editing.
								if (editingSource) event.preventDefault();
							}}
							>{#if !textItem}<DropdownMenu.Item
									class="menu-item"
									onSelect={() => (editingSource = true)}
									><PencilIcon /><span>Edit link</span></DropdownMenu.Item
								><DropdownMenu.Separator class="menu-separator" />{/if}<DropdownMenu.Item
								class="menu-item danger-text"
								onSelect={moveToTrash}><Trash2Icon /><span>Move to trash</span></DropdownMenu.Item
							></DropdownMenu.Content
						></DropdownMenu.Portal
					></DropdownMenu.Root
				>{/if}
			<button class="icon-button" onclick={close} aria-label="Close editor"><XIcon /></button>
		</span>
	</header>
	<div class="inspector-body">
		{#if !row}<p class="panel-message">This bookmark is unavailable.</p>{:else}
			{#if row.deletedAt}<div class="editor-trash" role="status">
					<Trash2Icon /><span>In trash</span><button onclick={() => lifecycle('restore')}
						><RotateCcwIcon />Restore</button
					><button class="danger" data-cuelume-warning onclick={() => (purgeOpen = true)}
						>Delete forever</button
					>
				</div>{/if}
			<label class="sr-only" for="item-title">Title</label><textarea
				id="item-title"
				class="editor-title"
				rows="1"
				placeholder="Untitled"
				bind:value={title}
				oninput={(e) => edited('title', e.currentTarget.value)}
				onblur={details}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						void details();
						e.currentTarget.blur();
					}
				}}
				maxlength="500"
				disabled={!!row.deletedAt}
				{@attach autosize(title)}></textarea>
			{#if error}<p class="form-error editor-error" role="alert">
					{error}{#if dirty}<button class="text-button" onclick={details}>Retry</button>{/if}
				</p>{/if}
			{#if !row.deletedAt}
				<!-- Properties: one quiet row each, an icon instead of a label. -->
				<div class="editor-props">
					<div class="editor-prop">
						<span class="editor-prop-icon" title="Tags"><HashIcon /></span>
						<TokenInput
							label="Tags"
							placeholder="Add a tag"
							allowCreate
							items={tags.map((t) => ({ value: String(t.id), label: String(t.name) }))}
							selected={(row.tagIds as string[]) ?? []}
							onAdd={addTag}
							onRemove={(tagId) => act({ type: 'tag.remove', id: entity.id, tagId })}
						/>
					</div>
					<div class="editor-prop">
						<span class="editor-prop-icon" title="People"><UsersIcon /></span>
						<TokenInput
							label="Connect people"
							placeholder="Connect a person"
							items={people.map((p) => ({ value: String(p.id), label: String(p.displayName) }))}
							selected={linkedPeople}
							onAdd={(id) =>
								act({
									type: 'content-person.add',
									bookmarkId: entity.id,
									personId: id,
									role: 'related',
									provenance: 'manual'
								})}
							onRemove={removePerson}
						>
							{#snippet glyph(item)}<PersonAvatar name={item.label} size={20} />{/snippet}
						</TokenInput>
					</div>
				</div>
				<NoteEditor
					{library}
					{entity}
					{version}
					{feedback}
					rendered={textItem}
					placeholder={textItem ? 'Write in Markdown…' : 'Write a note…'}
					onReference={(target) => navigate(target)}
				/>
				{#if incoming.length}<section class="editor-backlinks" aria-label="Linked here">
						<h3>Linked here</h3>
						{#each incoming as item (item.id)}<button
								class="editor-backlink"
								onclick={() => navigate({ kind: item.entityKind, id: String(item.id) })}
								>{#if item.entityKind === 'person'}<PersonAvatar
										name={String(item.displayName)}
										size={16}
									/>{:else}<BacklinkIcon />{/if}<span>{entityLabel(item)}</span></button
							>{/each}
					</section>{/if}
			{/if}
		{/if}
	</div>
</aside>
<AlertDialog.Root bind:open={purgeOpen}
	><AlertDialog.Portal
		><AlertDialog.Overlay class="dialog-overlay" /><AlertDialog.Content class="dialog-content"
			><AlertDialog.Title class="dialog-title">Delete permanently?</AlertDialog.Title
			><AlertDialog.Description class="dialog-description"
				>This removes the bookmark and its note. It cannot be undone.</AlertDialog.Description
			>
			<div class="button-row dialog-actions">
				<AlertDialog.Cancel class="secondary-button">Keep in trash</AlertDialog.Cancel
				><AlertDialog.Action class="danger-button" onclick={() => lifecycle('purge')}
					>Delete permanently</AlertDialog.Action
				>
			</div></AlertDialog.Content
		></AlertDialog.Portal
	></AlertDialog.Root
>
