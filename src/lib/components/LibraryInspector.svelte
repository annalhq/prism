<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- These dynamic links open external source and identity URLs. */
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import type { EntityRef } from '#lib/domain/entities.js';
	import type { Command, Revision } from '#lib/domain/contracts.js';
	import { normalizeUrl } from '#lib/domain/urls.js';
	import { extractReferences } from '#lib/domain/notes.js';
	import { isTweetSource } from '#lib/domain/relationships.js';
	import { entityLabel } from '#lib/client/search.js';
	import { AlertDialog } from 'bits-ui';
	import NoteEditor from './NoteEditor.svelte';
	let purgeOpen = $state(false);
	import SelectField from './ui/SelectField.svelte';
	import Check from './ui/Check.svelte';
	import IconXFill from 'phosphor-icons-svelte/IconXFill.svelte';
	import IconArrowUpRightFill from 'phosphor-icons-svelte/IconArrowUpRightFill.svelte';
	import IconPushPinFill from 'phosphor-icons-svelte/IconPushPinFill.svelte';
	import IconArchiveFill from 'phosphor-icons-svelte/IconArchiveFill.svelte';
	import IconTrashFill from 'phosphor-icons-svelte/IconTrashFill.svelte';
	type Row = Record<string, unknown>;
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
		description = $state(''),
		url = $state(''),
		metaBase = $state<Revision>('0'),
		loaded = $state(false),
		dirty = $state(false),
		busy = $state(false),
		error = $state('');
	let tagId = $state(''),
		personId = $state(''),
		role = $state<'author' | 'about' | 'related'>('related'),
		target = $state(''),
		personaId = $state('');
	let platform = $state(''),
		profileUrl = $state(''),
		nativeId = $state(''),
		handle = $state(''),
		confirmed = $state(false),
		feed = $state('all');
	const table = $derived(
		entity.kind === 'bookmark' ? 'bookmarks' : entity.kind === 'person' ? 'people' : 'personas'
	);
	const row = $derived.by(() => {
		void version;
		return library.get<Row>(table, entity.id);
	});
	const active = (tableName: 'tags' | 'collections' | 'people' | 'personas' | 'bookmarks') =>
		library.list<Row>(tableName).filter((r) => !r.deletedAt && !r.purgedAt);
	const tags = $derived.by(() => {
		void version;
		return active('tags');
	});
	const collections = $derived.by(() => {
		void version;
		return active('collections');
	});
	const people = $derived.by(() => {
		void version;
		return active('people');
	});
	const personas = $derived.by(() => {
		void version;
		return active('personas');
	});
	const members = $derived.by(() => {
		void version;
		return library.list<Row>('memberships').filter((m) => !m.deletedAt);
	});
	const relationships = $derived.by(() => {
		void version;
		return library.list<Row>('relationships').filter((r) => !r.deletedAt);
	});
	const identities = $derived.by(() => {
		void version;
		return library.list<Row>('identities').filter((r) => r.personId === entity.id && !r.deletedAt);
	});
	const allTargets = $derived.by(() => {
		void version;
		return [
			...active('bookmarks').map((r) => ({
				id: String(r.id),
				kind: 'bookmark' as const,
				title: entityLabel(r)
			})),
			...people.map((r) => ({ id: String(r.id), kind: 'person' as const, title: entityLabel(r) })),
			...personas.map((r) => ({
				id: String(r.id),
				kind: 'persona' as const,
				title: entityLabel(r)
			}))
		];
	});
	const outgoing = $derived.by(() => {
		void version;
		return (
			(library.get<Row>('links', entity.id)?.edges as { targetId: string; kind: string }[]) ?? []
		);
	});
	const backlinks = $derived.by(() => {
		void version;
		return library
			.list<Row>('notes')
			.filter(
				(note) =>
					note.entityId !== entity.id &&
					extractReferences(String(note.bodyMarkdown)).some((ref) => ref.id === entity.id)
			)
			.map((note) => allTargets.find((t) => t.id === note.entityId))
			.filter(Boolean) as typeof allTargets;
	});
	const feedRows = $derived.by(() => {
		void version;
		const relevant = relationships.filter(
			(r) =>
				r.personId === entity.id &&
				(feed === 'all' || feed === 'tweets' || r.role === (feed === 'authored' ? 'author' : feed))
		);
		return active('bookmarks').filter(
			(b) =>
				!b.archivedAt &&
				relevant.some((r) => r.bookmarkId === b.id) &&
				(feed !== 'tweets' || isTweetSource(String(b.kind), b.domain as string | null))
		);
	});
	const personaRows = $derived.by(() => {
		void version;
		const explicit = members
			.filter((m) => m.personaId === entity.id)
			.map((m) => m.member as EntityRef);
		if (feed === 'authored') {
			const ids = new Set(explicit.filter((m) => m.kind === 'person').map((m) => m.id));
			return active('bookmarks').filter(
				(b) =>
					!b.archivedAt &&
					relationships.some(
						(r) => r.bookmarkId === b.id && r.role === 'author' && ids.has(String(r.personId))
					)
			);
		}
		return allTargets.filter(
			(t) =>
				explicit.some((m) => m.id === t.id) &&
				(feed === 'all' || t.kind === (feed === 'people' ? 'person' : 'bookmark'))
		);
	});
	$effect(() => {
		if (row && (!loaded || !dirty)) {
			title = entityLabel(row);
			description = String(row.description ?? row.bio ?? '');
			url = String(row.url ?? row.website ?? '');
			metaBase = String(row.revision) as Revision;
			loaded = true;
		}
	});
	const safeSource = $derived.by(() => {
		try {
			return normalizeUrl(url).url;
		} catch {
			return null;
		}
	});
	function labelFor(id: string) {
		const target = allTargets.find((r) => r.id === id);
		if (target) return target.title;
		const registry = library.get<Row>('entities', id);
		return registry?.purgedAt
			? 'Deleted target'
			: registry?.deletedAt
				? 'In trash'
				: 'Unavailable target';
	}
	function refFor(id: string): EntityRef {
		const target = allTargets.find((r) => r.id === id);
		const registry = library.get<Row>('entities', id);
		return { kind: target?.kind ?? (registry?.kind as EntityRef['kind']) ?? 'bookmark', id };
	}
	async function act(command: Command) {
		busy = true;
		error = '';
		try {
			const result = await library.save(command);
			if (result.status === 'rejected') {
				error = result.message ?? 'This change could not be saved.';
				return false;
			}
			feedback(result.message ?? 'Saved.');
			return true;
		} catch (e) {
			error = (e as Error).message;
			return false;
		} finally {
			busy = false;
		}
	}
	function revision(): Revision {
		return String(row?.revision ?? '0') as Revision;
	}
	async function saveMetadata() {
		const patch =
			entity.kind === 'bookmark'
				? { title, description, url: url || null }
				: entity.kind === 'person'
					? { displayName: title, bio: description, website: url || null }
					: { name: title, description };
		if (
			await act({
				type: `${entity.kind}.update`,
				id: entity.id,
				expectedRevision: metaBase,
				patch
			} as Command)
		) {
			dirty = false;
			metaBase = revision();
		}
	}
	async function organize(patch: Record<string, unknown>) {
		await act({
			type: 'bookmark.organize',
			id: entity.id,
			expectedRevision: revision(),
			patch
		} as Command);
	}
	async function lifecycle(action: 'trash' | 'restore' | 'purge', approved = false) {
		if (action === 'purge' && !approved) {
			purgeOpen = true;
			return;
		}
		if (
			await act({
				type: `${entity.kind}.${action}`,
				id: entity.id,
				expectedRevision: revision()
			} as Command)
		) {
			if (action === 'purge') close();
		}
	}
	async function addIdentity() {
		if (
			await act({
				type: 'person-identity.add',
				id: crypto.randomUUID(),
				personId: entity.id,
				platform,
				profileUrl,
				nativeAccountId: nativeId || null,
				handle: handle || null,
				confirmed: true
			})
		) {
			platform = '';
			profileUrl = '';
			nativeId = '';
			handle = '';
			confirmed = false;
		}
	}
	async function addRelated() {
		const [kind, id] = target.split('/');
		if (
			await act({
				type: 'related-link.add',
				id: entity.id,
				expectedRevision: revision(),
				target: { kind: kind as EntityRef['kind'], id }
			})
		)
			target = '';
	}
</script>

<aside class="library-inspector" aria-label="Selected item">
	<div class="inspector-top">
		<span class="eyebrow"
			>{entity.kind === 'bookmark'
				? 'Saved content'
				: entity.kind === 'person'
					? 'Person'
					: 'Knowledge context'}</span
		><button class="icon-button" onclick={close} aria-label="Close inspector"><IconXFill /></button>
	</div>
	{#if !row}<div class="panel-message">
			<h2>Item unavailable</h2>
			<p>It may have been permanently removed.</p>
		</div>{:else}
		{#if row.deletedAt}<div class="notice">
				In trash <button onclick={() => lifecycle('restore')} disabled={busy}>Restore</button
				><button class="danger-button" onclick={() => lifecycle('purge')} disabled={busy}
					>Delete permanently</button
				>
			</div>{/if}
		<section class="inspector-section">
			<label for="item-title">{entity.kind === 'person' ? 'Name' : 'Title'}</label><textarea
				rows="2"
				id="item-title"
				bind:value={title}
				oninput={() => (dirty = true)}
				maxlength={entity.kind === 'person' ? 200 : entity.kind === 'persona' ? 64 : 500}
				disabled={!!row.deletedAt}></textarea><label for="item-description"
				>{entity.kind === 'person' ? 'Bio' : 'Description'}</label
			><textarea
				id="item-description"
				bind:value={description}
				oninput={() => (dirty = true)}
				rows="3"
				maxlength="10000"
				disabled={!!row.deletedAt}></textarea>{#if entity.kind !== 'persona'}<label for="item-url"
					>{entity.kind === 'person' ? 'Website' : 'Source URL'}</label
				><input
					id="item-url"
					type="url"
					bind:value={url}
					oninput={() => (dirty = true)}
					disabled={!!row.deletedAt}
				/>{#if safeSource}<a
						class="source-link"
						href={safeSource ?? undefined}
						target="_blank"
						rel="noopener noreferrer"
						onclick={() => {
							if (entity.kind === 'bookmark')
								void library.save({ type: 'activity.open', id: entity.id });
						}}>Open source <IconArrowUpRightFill /></a
					>{/if}{/if}
			{#if dirty}<div class="button-row">
					<button class="primary-button" onclick={saveMetadata} disabled={busy || !!row.deletedAt}
						>Save details</button
					>{#if row.revision !== metaBase}<span class="muted"
							>Details changed elsewhere; saving will ask you to review.</span
						><button
							onclick={() => {
								title = entityLabel(row);
								description = String(row.description ?? row.bio ?? '');
								url = String(row.url ?? row.website ?? '');
								metaBase = revision();
								dirty = false;
							}}>Reload details</button
						>{/if}
				</div>{/if}
			{#if !row.deletedAt}<div class="button-row">
					{#if entity.kind === 'bookmark'}<button
							onclick={() => organize({ isPinned: !row.isPinned })}
							disabled={busy}
							aria-pressed={!!row.isPinned}
							><IconPushPinFill />{row.isPinned ? 'Unpin' : 'Pin'}</button
						><button onclick={() => organize({ isArchived: !row.archivedAt })} disabled={busy}
							><IconArchiveFill />{row.archivedAt ? 'Unarchive' : 'Archive'}</button
						>{/if}<button onclick={() => lifecycle('trash')} disabled={busy}
						><IconTrashFill />Move to trash</button
					>
				</div>{/if}
		</section>
		{#if error}<p class="form-error inset" role="alert">{error}</p>{/if}
		{#if !row.deletedAt}
			{#if entity.kind === 'bookmark'}<section class="inspector-section form-grid">
					<label for="reading-status">Reading</label><SelectField
						label="Reading status"
						value={String(row.readingStatus)}
						options={[
							{ value: 'unread', label: 'Unread' },
							{ value: 'reading', label: 'Reading' },
							{ value: 'read', label: 'Read' }
						]}
						id="reading-status"
						disabled={busy}
						onValueChange={(value) => organize({ readingStatus: value })}
					/><label for="collection">Collection</label><SelectField
						label="Collection"
						value={String(row.collectionId ?? '')}
						options={[
							{ value: '', label: 'Inbox · no collection' },
							...collections.map((r) => ({ value: String(r.id), label: String(r.name) }))
						]}
						id="collection"
						disabled={busy}
						onValueChange={(value) => organize({ collectionId: value || null })}
					/>
				</section>{/if}
			<NoteEditor {library} {entity} {version} {feedback} {navigate} />
			<section class="inspector-section">
				<h3>Tags</h3>
				<div class="chip-list">
					{#each (row.tagIds as string[]) ?? [] as id (id)}<span class="chip"
							>{tags.find((t) => t.id === id)?.name ?? 'Unavailable tag'}<button
								aria-label="Remove tag"
								onclick={() => act({ type: 'tag.remove', id: entity.id, tagId: id })}
								><IconXFill /></button
							></span
						>{/each}
				</div>
				<div class="button-row">
					<SelectField
						label="Add tag"
						bind:value={tagId}
						options={[
							{ value: '', label: 'Choose a tag…' },
							...tags.map((r) => ({ value: String(r.id), label: String(r.name) }))
						]}
					/><button
						onclick={async () => {
							if (await act({ type: 'tag.add', id: entity.id, tagId })) tagId = '';
						}}
						disabled={!tagId}>Add</button
					>
				</div>
			</section>
			{#if entity.kind === 'bookmark'}<section class="inspector-section">
					<h3>People</h3>
					{#each relationships.filter((r) => r.bookmarkId === entity.id) as relation (`${relation.bookmarkId}/${relation.personId}/${relation.role}`)}<div
							class="relation-row"
						>
							<button
								class="text-button"
								onclick={() => navigate({ kind: 'person', id: String(relation.personId) })}
								>{labelFor(String(relation.personId))}</button
							><span class="muted"
								>{relation.role} · {relation.provenance === 'manual'
									? 'Manual'
									: 'Confirmed capture'}</span
							><button
								aria-label="Remove person association"
								onclick={() =>
									act({
										type: 'content-person.remove',
										bookmarkId: entity.id,
										personId: String(relation.personId),
										role: relation.role as 'author'
									})}><IconXFill /></button
							>
						</div>{/each}<SelectField
						label="Person"
						bind:value={personId}
						options={[
							{ value: '', label: 'Choose a person…' },
							...people.map((r) => ({ value: String(r.id), label: String(r.displayName) }))
						]}
					/>
					<div class="button-row">
						<SelectField
							label="Person role"
							value={role}
							options={[
								{ value: 'related', label: 'Related' },
								{ value: 'author', label: 'Author' },
								{ value: 'about', label: 'About' }
							]}
							onValueChange={(value) => (role = value as typeof role)}
						/><button
							disabled={!personId}
							onclick={async () => {
								if (
									await act({
										type: 'content-person.add',
										bookmarkId: entity.id,
										personId,
										role,
										provenance: 'manual'
									})
								)
									personId = '';
							}}>Assign</button
						>
					</div>
				</section>{/if}
			{#if entity.kind !== 'persona'}<section class="inspector-section">
					<h3>Contexts</h3>
					<div class="chip-list">
						{#each members.filter((m) => (m.member as EntityRef).id === entity.id) as membership (membership.personaId)}<span
								class="chip"
								><button
									class="text-button"
									onclick={() => navigate({ kind: 'persona', id: String(membership.personaId) })}
									>{labelFor(String(membership.personaId))}</button
								><button
									aria-label="Remove persona membership"
									onclick={() =>
										act({
											type: 'persona-member.remove',
											personaId: String(membership.personaId),
											member: entity as { kind: 'bookmark' | 'person'; id: string }
										})}><IconXFill /></button
								></span
							>{/each}
					</div>
					<div class="button-row">
						<SelectField
							label="Persona"
							bind:value={personaId}
							options={[
								{ value: '', label: 'Choose a context…' },
								...personas.map((r) => ({ value: String(r.id), label: String(r.name) }))
							]}
						/><button
							disabled={!personaId}
							onclick={async () => {
								if (
									await act({
										type: 'persona-member.add',
										personaId,
										member: entity as { kind: 'bookmark' | 'person'; id: string }
									})
								)
									personaId = '';
							}}>Add</button
						>
					</div>
				</section>{/if}
			{#if entity.kind === 'person'}<section class="inspector-section">
					<h3>Saved content</h3>
					<SelectField
						label="Person feed"
						bind:value={feed}
						options={[
							{ value: 'all', label: 'All associations' },
							{ value: 'authored', label: 'Authored' },
							{ value: 'about', label: 'About' },
							{ value: 'related', label: 'Related' },
							{ value: 'tweets', label: 'Tweets' }
						]}
					/>{#each feedRows as item (item.id)}<button
							class="connection-link"
							onclick={() => navigate({ kind: 'bookmark', id: String(item.id) })}
							>{item.title}</button
						>{:else}<p class="muted">No saved content in this view yet.</p>{/each}
				</section>
				<section class="inspector-section">
					<h3>Confirmed identities</h3>
					{#each identities as identity (identity.id)}<div class="relation-row">
							<a href={String(identity.profileUrl)} target="_blank" rel="noopener noreferrer"
								>{identity.platform} · {identity.handle ?? identity.profileUrl}</a
							><button
								aria-label="Remove identity"
								onclick={() =>
									act({
										type: 'person-identity.remove',
										id: String(identity.id),
										personId: entity.id,
										expectedRevision: String(identity.revision) as Revision
									})}><IconXFill /></button
							>
						</div>{/each}
					<details>
						<summary>Add a confirmed identity</summary>
						<div class="stack">
							<label for="identity-platform">Platform</label><input
								id="identity-platform"
								bind:value={platform}
								placeholder="github, x, website…"
							/><label for="identity-url">Profile URL</label><input
								id="identity-url"
								type="url"
								bind:value={profileUrl}
							/><label for="identity-handle">Handle (optional)</label><input
								id="identity-handle"
								bind:value={handle}
							/><label for="identity-native">Platform account ID (optional)</label><input
								id="identity-native"
								bind:value={nativeId}
							/><label class="checkbox-label"
								><Check bind:checked={confirmed} label="I confirm this is the same person" /> I confirm
								this is the same person</label
							><button disabled={!confirmed || !platform || !profileUrl} onclick={addIdentity}
								>Add identity</button
							>
						</div>
					</details>
				</section>{/if}
			{#if entity.kind === 'persona'}<section class="inspector-section">
					<h3>Members</h3>
					<SelectField
						label="Context view"
						bind:value={feed}
						options={[
							{ value: 'all', label: 'Explicit members' },
							{ value: 'people', label: 'People' },
							{ value: 'content', label: 'Content' },
							{ value: 'authored', label: 'From these people · authored content' }
						]}
					/>{#if feed === 'authored'}<p class="muted">
							Derived from member people. These items are not automatically assigned to this
							context.
						</p>{/if}{#each personaRows as item (item.id)}<div class="relation-row">
							<button
								class="connection-link"
								onclick={() =>
									navigate({
										kind: item.kind === 'person' ? 'person' : 'bookmark',
										id: String(item.id)
									})}>{item.title ?? entityLabel(item)}</button
							>{#if feed !== 'authored'}<button
									aria-label="Remove member"
									onclick={() =>
										act({
											type: 'persona-member.remove',
											personaId: entity.id,
											member: {
												kind: item.kind === 'person' ? 'person' : 'bookmark',
												id: String(item.id)
											}
										})}><IconXFill /></button
								>{/if}
						</div>{:else}<p class="muted">Add people or content to start this context.</p>{/each}
					<div class="button-row">
						<SelectField
							label="New context member"
							bind:value={target}
							options={[
								{ value: '', label: 'Choose a member…' },
								...allTargets
									.filter((t) => t.kind !== 'persona')
									.map((t) => ({ value: `${t.kind}/${t.id}`, label: `${t.kind} · ${t.title}` }))
							]}
						/><button
							disabled={!target}
							onclick={async () => {
								const [kind, id] = target.split('/');
								if (
									await act({
										type: 'persona-member.add',
										personaId: entity.id,
										member: { kind: kind as 'person' | 'bookmark', id }
									})
								)
									target = '';
							}}>Add</button
						>
					</div>
				</section>{/if}
			<section class="inspector-section">
				<h3>Backlinks</h3>
				{#each backlinks as source (source.id)}<button
						class="connection-link"
						onclick={() => navigate({ kind: source.kind, id: source.id })}>{source.title}</button
					>{:else}<p class="muted">Notes that link here will appear here.</p>{/each}
			</section>
			<section class="inspector-section">
				<h3>Related links</h3>
				{#each outgoing.filter((e) => e.kind === 'related') as edge (edge.targetId)}<div
						class="relation-row"
					>
						<button class="connection-link" onclick={() => navigate(refFor(edge.targetId))}
							>{labelFor(edge.targetId)}</button
						><button
							aria-label="Remove related link"
							onclick={() =>
								act({
									type: 'related-link.remove',
									id: entity.id,
									expectedRevision: revision(),
									target: refFor(edge.targetId)
								})}><IconXFill /></button
						>
					</div>{/each}
				<div class="button-row">
					<SelectField
						label="Related target"
						bind:value={target}
						options={[
							{ value: '', label: 'Choose a target…' },
							...allTargets.map((t) => ({ value: `${t.kind}/${t.id}`, label: t.title }))
						]}
					/><button onclick={addRelated} disabled={!target}>Link</button>
				</div>
			</section>
		{/if}
	{/if}
</aside>

<AlertDialog.Root bind:open={purgeOpen}>
	<AlertDialog.Portal
		><AlertDialog.Overlay class="dialog-overlay" /><AlertDialog.Content class="dialog-content">
			<AlertDialog.Title class="dialog-title">Delete this item permanently?</AlertDialog.Title>
			<AlertDialog.Description class="dialog-description"
				>Its note and owned data will be removed. This action cannot be undone.</AlertDialog.Description
			>
			<div class="button-row dialog-actions">
				<AlertDialog.Cancel class="secondary-button">Keep in trash</AlertDialog.Cancel
				><AlertDialog.Action
					class="danger-button"
					onclick={() => lifecycle('purge', true)}
					disabled={busy}>Delete permanently</AlertDialog.Action
				>
			</div>
		</AlertDialog.Content></AlertDialog.Portal
	>
</AlertDialog.Root>
