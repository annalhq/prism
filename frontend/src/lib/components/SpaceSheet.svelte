<script lang="ts">
	import { Check, Search, Trash2, X as XIcon } from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import { untrack } from 'svelte';
	import type { Revision } from '#lib/domain/contracts.js';
	import { normalizeOrganizationName } from '#lib/domain/organization.js';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { placeInSpace, spaceOf } from '#lib/client/workflows.js';
	import { hueColor, spaceHue, spaceInitial } from '#lib/client/spaces.svelte.js';
	import FolderGlyph from './ui/FolderGlyph.svelte';

	type Row = Record<string, unknown>;
	// Creates or edits a space: its name, colour, and the folders and loose tags it shows.
	let {
		open = $bindable(false),
		space = null,
		armDelete = false,
		spaces,
		tags,
		folders,
		library,
		onSaved,
		onError
	}: {
		open?: boolean;
		// Null makes a new space.
		space?: Row | null;
		armDelete?: boolean;
		spaces: Row[];
		tags: Row[];
		folders: Row[];
		library: LibraryClient | null;
		onSaved: (message: string, id?: string) => void;
		onError: (message: string) => void;
	} = $props();

	let name = $state(''),
		chosen = $state<string[]>([]),
		// The chosen hue in degrees, or null to keep the one derived from the name.
		hue = $state<number | null>(null),
		filter = $state(''),
		busy = $state(false),
		deleteArmed = $state(false),
		error = $state('');
	const id = $derived(space ? String(space.id) : '');
	const loose = $derived(tags.filter((t) => !folders.some((f) => f.id === t.folderId)));
	const items = $derived([
		...folders.map((row) => ({ row, key: `folders:${row.id}`, folder: true })),
		...loose.map((row) => ({ row, key: `tags:${row.id}`, folder: false }))
	]);
	const spaceName = (spaceId: string) =>
		spaceId ? String(spaces.find((s) => s.id === spaceId)?.name ?? '') : 'Home';
	const members = () =>
		id
			? untrack(() => items)
					.filter((item) => spaceOf(item.row, folders, spaces) === id)
					.map((item) => item.key)
			: [];
	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = space ? String(space.name) : '';
			hue = typeof space?.hue === 'number' ? space.hue : null;
			chosen = members();
			filter = '';
			deleteArmed = armDelete;
			error = '';
		});
	});
	const normalized = (value: string) => {
		try {
			return normalizeOrganizationName(value).normalizedName;
		} catch {
			return '';
		}
	};
	const taken = $derived(
		!!name.trim() &&
			(normalized(name) === normalized('Home') ||
				spaces.some((s) => s.id !== id && normalized(String(s.name)) === normalized(name)))
	);
	const needle = $derived(filter.trim().replace(/^#/, '').toLocaleLowerCase());
	const visible = $derived(
		needle ? items.filter((i) => String(i.row.name).toLocaleLowerCase().includes(needle)) : items
	);
	const savedHue = $derived(typeof space?.hue === 'number' ? space.hue : null);
	const changed = $derived(
		!space ||
			name.trim() !== String(space.name) ||
			hue !== savedHue ||
			[...chosen].sort().join() !== members().sort().join()
	);
	// Previews the chosen hue, or the one this name would get.
	const shownHue = $derived(hue ?? spaceHue({ id: 'preview', name: name.trim() || 'space' })!);
	const color = $derived(hueColor(shownHue));
	const HUE_TRACK = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => hueColor(i * 30)).join(', ')})`;
	function toggle(key: string) {
		chosen = chosen.includes(key) ? chosen.filter((x) => x !== key) : [...chosen, key];
	}
	const split = (keys: string[], table: 'folders' | 'tags') =>
		keys.filter((k) => k.startsWith(`${table}:`)).map((k) => k.slice(table.length + 1));
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!library || busy || taken || !name.trim()) return;
		busy = true;
		error = '';
		try {
			let target = id;
			if (!space) {
				target = crypto.randomUUID();
				const result = await library.save({ type: 'space.create', id: target, name });
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not make this space.');
			} else if (name.trim() !== String(space.name)) {
				const current = library.get<Row>('spaces', id) ?? space;
				const result = await library.save({
					type: 'space.rename',
					id,
					expectedRevision: String(current.revision) as Revision,
					name
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not rename this space.');
			}
			if (hue !== savedHue) {
				const current = library.get<Row>('spaces', target);
				const result = await library.save({
					type: 'space.hue',
					id: target,
					expectedRevision: String(current?.revision ?? '1') as Revision,
					hue
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not save the colour.');
			}
			const before = members();
			const added = chosen.filter((k) => !before.includes(k));
			const removed = before.filter((k) => !chosen.includes(k));
			await placeInSpace(library, 'folders', split(added, 'folders'), target);
			await placeInSpace(library, 'tags', split(added, 'tags'), target);
			await placeInSpace(library, 'folders', split(removed, 'folders'), null);
			await placeInSpace(library, 'tags', split(removed, 'tags'), null);
			open = false;
			onSaved(space ? 'Space saved.' : `${name.trim()} is ready.`, target);
		} catch (e) {
			error = (e as Error).message;
			onError(error);
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (!library || busy || !space) return;
		busy = true;
		try {
			const current = library.get<Row>('spaces', id) ?? space;
			const result = await library.save({
				type: 'space.delete',
				id,
				expectedRevision: String(current.revision) as Revision
			});
			if (result.status === 'rejected')
				throw new Error(result.message ?? 'Could not delete this space.');
			open = false;
			onSaved('Space deleted. What it held is back in Home.');
		} catch (e) {
			error = (e as Error).message;
			onError(error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content name-sheet folder-sheet space-sheet"
			style={`--space-color: ${color}`}
		>
			<header class="name-sheet-head">
				<Dialog.Title class="name-sheet-title">{space ? 'Edit space' : 'New space'}</Dialog.Title>
				<Dialog.Close class="icon-button name-sheet-close" disabled={busy} aria-label="Close space"
					><XIcon /></Dialog.Close
				>
			</header>
			<Dialog.Description class="sr-only"
				>Name this space and choose the folders and tags it shows in the sidebar. Bookmarks don't
				move.</Dialog.Description
			>
			<form class="name-sheet-form" onsubmit={save}>
				<fieldset disabled={busy}>
					<label class="name-sheet-name">
						<span class="sr-only">Name</span>
						<span class="name-sheet-glyph"
							><span class="space-chip space-chip-large">{spaceInitial(name || 'S')}</span></span
						>
						<input
							bind:value={name}
							required
							maxlength="64"
							placeholder="Tech, Exploration…"
							autocomplete="off"
							spellcheck="false"
						/>
					</label>
					{#if taken}<p class="name-sheet-hint exists">A space by that name already exists.</p>{/if}
					<div class="space-hue">
						<span class="space-hue-label">Colour</span>
						<input
							type="range"
							min="0"
							max="359"
							step="1"
							aria-label="Space colour"
							value={shownHue}
							style:--hue-track={HUE_TRACK}
							oninput={(e) => (hue = Number(e.currentTarget.value))}
						/>
						<button
							type="button"
							class="space-hue-auto"
							aria-pressed={hue === null}
							title="Pick a colour from the name"
							onclick={() => (hue = null)}>Auto</button
						>
					</div>
					{#if items.length}<div class="folder-sheet-tags" role="group" aria-label="In this space">
							<div class="folder-sheet-tags-head">
								<span>Shows</span><small>{chosen.length}</small>
								{#if items.length > 12}<label class="folder-sheet-filter"
										><Search /><input
											bind:value={filter}
											placeholder="Find"
											aria-label="Find a folder or tag"
											autocomplete="off"
											spellcheck="false"
											onkeydown={(e) => {
												if (e.key === 'Enter') e.preventDefault();
											}}
										/></label
									>{/if}
							</div>
							<div class="folder-sheet-chips">
								{#each visible as item (item.key)}
									{@const current = spaceOf(item.row, folders, spaces)}
									{@const picked = chosen.includes(item.key)}
									{@const elsewhere = current && current !== id ? spaceName(current) : ''}
									<button
										type="button"
										class="folder-chip"
										aria-pressed={picked}
										title={elsewhere && !picked
											? `In ${elsewhere}; choosing it moves it here`
											: undefined}
										onclick={() => toggle(item.key)}
										>{#if picked}<Check />{:else if item.folder}<FolderGlyph />{:else}<span
												aria-hidden="true">#</span
											>{/if}{item.row.name}{#if elsewhere && !picked}<small>{elsewhere}</small
											>{/if}</button
									>
								{:else}<p class="folder-sheet-none">Nothing by that name.</p>{/each}
							</div>
						</div>{:else}<p class="name-sheet-hint">
							No tags yet. Make a few, then gather them here.
						</p>{/if}
					{#if error}<p class="form-error" role="alert">{error}</p>{/if}
					<footer class="name-sheet-actions">
						{#if deleteArmed && space}<span class="name-sheet-confirm"
								><span>Delete {space.name}? Its tags go back to Home.</span><button
									type="button"
									class="name-sheet-cancel"
									onclick={() => (deleteArmed = false)}>Keep</button
								><button
									type="button"
									class="name-sheet-danger"
									data-cuelume-warning
									onclick={() => void remove()}>Delete</button
								></span
							>{:else}{#if space}<button
									type="button"
									class="name-sheet-delete"
									onclick={() => (deleteArmed = true)}><Trash2 />Delete</button
								>{/if}<button
								type="submit"
								class="name-sheet-submit"
								disabled={busy || !name.trim() || taken || !changed}
								>{busy ? 'Saving…' : space ? 'Save' : 'Create'}</button
							>{/if}
					</footer>
				</fieldset>
			</form>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
