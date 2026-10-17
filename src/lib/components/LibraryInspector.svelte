<script lang="ts">
	import {
		X as XIcon,
		Bookmark as BookmarkIcon,
		ArrowUpRight as ArrowUpRightIcon,
		Clock3 as Clock3Icon
	} from '@lucide/svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- Source links are validated external HTTP URLs. */
	import { SvelteSet } from 'svelte/reactivity';
	import { AlertDialog } from 'bits-ui';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { Command, Revision } from '#lib/domain/contracts.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { extractReferences } from '#lib/domain/notes.js';
	import { entityLabel } from '#lib/client/search.js';
	import { ensureTag, isReadLater, type Row } from '#lib/client/workflows.js';
	import NoteEditor from './NoteEditor.svelte';
	import TokenInput from './ui/TokenInput.svelte';
	import SelectField from './ui/SelectField.svelte';
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
		purgeOpen = $state(false);
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
	const collections = $derived.by(() => {
		void version;
		return library.list<Row>('collections').filter((c) => !c.deletedAt);
	});
	const incoming = $derived.by(() => {
		void version;
		const ids = new SvelteSet(
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
		if (result.status === 'rejected')
			throw new Error(result.message ?? 'Could not save this change.');
		feedback(result.status === 'queued' ? 'Saved on this device.' : 'Saved.');
	}
	async function details() {
		if (!dirty || busy || !row || row.deletedAt) return;
		busy = true;
		error = '';
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
			if (title === sentTitle && url === sentUrl) dirty = false;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
	async function organize(patch: {
		readingStatus?: 'unread' | 'reading';
		collectionId?: string | null;
	}) {
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
	<div class="inspector-top">
		<div class="editor-heading">
			<span class="editor-mark"><BookmarkIcon /></span>
			<div>
				<h2>Edit bookmark</h2>
				<p>Changes save automatically.</p>
			</div>
		</div>
		<button class="icon-button" onclick={close} aria-label="Close editor"><XIcon /></button>
	</div>
	<div class="inspector-body">
		{#if !row}<p class="panel-message">This bookmark is unavailable.</p>{:else}
			{#if row.deletedAt}<div class="notice">
					In trash <button onclick={() => lifecycle('restore')}>Restore</button><button
						onclick={() => (purgeOpen = true)}>Delete permanently</button
					>
				</div>{/if}
			<section class="inspector-section bookmark-details">
				<label for="item-title">Title</label><textarea
					id="item-title"
					rows="2"
					bind:value={title}
					oninput={() => (dirty = true)}
					onblur={details}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
							e.preventDefault();
							void details();
						}
					}}
					maxlength="500"
					disabled={!!row.deletedAt}></textarea>
				<div class="bookmark-source-row">
					{#if safeSource}<a
							class="source-link"
							href={safeSource}
							target="_blank"
							rel="noopener noreferrer"
							onclick={() => void library.save({ type: 'activity.open', id: entity.id })}
							>{new URL(safeSource).hostname}<ArrowUpRightIcon /></a
						>{/if}
					{#if !row.deletedAt}<button
							class="secondary-button later-toggle"
							aria-pressed={isReadLater(row)}
							onclick={() => organize({ readingStatus: isReadLater(row) ? 'unread' : 'reading' })}
							><Clock3Icon />{isReadLater(row) ? 'Saved for later' : 'Read later'}</button
						>{/if}
				</div>
			</section>
			{#if error}<p class="form-error" role="alert">{error}</p>
				{#if dirty}<button class="text-button" onclick={details}>Retry saving title</button
					>{/if}{/if}
			{#if !row.deletedAt}
				<NoteEditor {library} {entity} {version} {feedback} {navigate} />
				<div class="editor-organization">
					<section class="inspector-section">
						<h3>Tags</h3>
						<TokenInput
							label="Tags"
							placeholder="Add tags…"
							allowCreate
							items={tags.map((t) => ({ value: String(t.id), label: String(t.name) }))}
							selected={(row.tagIds as string[]) ?? []}
							onAdd={addTag}
							onRemove={(tagId) => act({ type: 'tag.remove', id: entity.id, tagId })}
						/>
					</section>
					<section class="inspector-section">
						<h3>People</h3>
						<TokenInput
							label="Connect people"
							placeholder="Find a person…"
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
						/>
					</section>
				</div>
				{#if incoming.length}<section class="inspector-section">
						<h3>Linked here</h3>
						{#each incoming as item (item.id)}<button
								class="connection-link"
								onclick={() => navigate({ kind: item.entityKind, id: String(item.id) })}
								>{entityLabel(item)}</button
							>{/each}
					</section>{/if}
				<section class="inspector-section source-section">
					<h3>Source & collection</h3>
					<div class="field">
						<label for="item-url">Source URL</label><input
							id="item-url"
							type="url"
							bind:value={url}
							oninput={() => (dirty = true)}
							onblur={details}
						/>
					</div>
					<div class="field">
						<label for="item-collection">Collection</label><SelectField
							id="item-collection"
							label="Collection"
							value={String(row.collectionId ?? '')}
							options={[
								{ value: '', label: 'No collection' },
								...collections.map((c) => ({ value: String(c.id), label: String(c.name) }))
							]}
							onValueChange={(value) => organize({ collectionId: value || null })}
						/>
					</div>
				</section>
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
