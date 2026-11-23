<script lang="ts">
	import { Check, ImagePlus, Search, Trash2, X as XIcon } from '@lucide/svelte';
	import { Dialog, Popover } from 'bits-ui';
	import { untrack } from 'svelte';
	import type { Revision } from '#lib/domain/contracts.js';
	import { normalizeOrganizationName } from '#lib/domain/organization.js';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import {
		defaultSpaceId,
		ensureDefaultSpace,
		placeInSpace,
		setDefaultSpace,
		spaceOf
	} from '#lib/client/workflows.js';
	import {
		loadCatalog,
		stickers,
		type Sticker as StickerDef
	} from '#lib/client/stickers.svelte.js';
	import FolderGlyph from './ui/FolderGlyph.svelte';
	import Sticker from './ui/Sticker.svelte';

	type Row = Record<string, unknown>;
	// Creates or edits a space: its name, optional icon, and the folders and loose tags it shows.
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
		// A sticker id, or null to show the name alone.
		icon = $state<string | null>(null),
		iconsOpen = $state(false),
		iconFilter = $state(''),
		catalog = $state.raw<StickerDef[] | null>(null),
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
	const spaceName = (spaceId: string) => String(spaces.find((s) => s.id === spaceId)?.name ?? '');
	const isDefault = $derived(!!id && defaultSpaceId(spaces) === id);
	const defaultName = $derived(spaceName(defaultSpaceId(spaces)));
	// The default can't go while other spaces depend on it to hold what's unplaced.
	const lockedDefault = $derived(isDefault && spaces.length > 1);
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
			icon = typeof space?.icon === 'string' ? space.icon : null;
			iconsOpen = false;
			iconFilter = '';
			chosen = members();
			filter = '';
			deleteArmed = armDelete && !lockedDefault;
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
			spaces.some((s) => s.id !== id && normalized(String(s.name)) === normalized(name))
	);
	const needle = $derived(filter.trim().replace(/^#/, '').toLocaleLowerCase());
	const visible = $derived(
		needle ? items.filter((i) => String(i.row.name).toLocaleLowerCase().includes(needle)) : items
	);
	const savedIcon = $derived(typeof space?.icon === 'string' ? space.icon : null);
	const changed = $derived(
		!space ||
			name.trim() !== String(space.name) ||
			icon !== savedIcon ||
			[...chosen].sort().join() !== members().sort().join()
	);
	const chosenSticker = $derived(
		icon ? (stickers.get(icon) ?? catalog?.find((s) => s.id === icon)) : undefined
	);
	const iconNeedle = $derived(iconFilter.trim().toLocaleLowerCase());
	const shownStickers = $derived(
		iconNeedle
			? (catalog ?? []).filter(
					(s) =>
						s.name.toLocaleLowerCase().includes(iconNeedle) ||
						s.tags.some((tag) => tag.includes(iconNeedle))
				)
			: (catalog ?? [])
	);
	async function openIcons(next: boolean) {
		iconsOpen = next;
		if (next && !catalog) catalog = await loadCatalog().catch(() => []);
	}
	function pick(sticker: StickerDef | null) {
		if (sticker) stickers.set(sticker.id, sticker);
		icon = sticker?.id ?? null;
		iconsOpen = false;
	}
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
			if (icon !== savedIcon) {
				const current = library.get<Row>('spaces', target);
				const result = await library.save({
					type: 'space.icon',
					id: target,
					expectedRevision: String(current?.revision ?? '1') as Revision,
					icon
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not save the icon.');
			}
			const before = members();
			const added = chosen.filter((k) => !before.includes(k));
			const removed = before.filter((k) => !chosen.includes(k));
			await placeInSpace(library, 'folders', split(added, 'folders'), target);
			await placeInSpace(library, 'tags', split(added, 'tags'), target);
			await placeInSpace(library, 'folders', split(removed, 'folders'), null);
			await placeInSpace(library, 'tags', split(removed, 'tags'), null);
			if (!space)
				await ensureDefaultSpace(library, [
					...spaces,
					library.get<Row>('spaces', target) ?? { id: target, name }
				]);
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
			onSaved(`Space deleted. What it held is back in ${defaultName}.`);
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
					<div class="name-sheet-name space-name-field">
						<Popover.Root open={iconsOpen} onOpenChange={(next) => void openIcons(next)}>
							<Popover.Trigger
								type="button"
								class={['space-icon-trigger', !chosenSticker && 'empty']}
								aria-label={chosenSticker ? `Icon: ${chosenSticker.name}. Change icon` : 'Add icon'}
								title={chosenSticker ? 'Change icon' : 'Add icon'}
								>{#if chosenSticker}<Sticker sticker={chosenSticker} size={26} />{:else}<ImagePlus
									/>{/if}</Popover.Trigger
							>
							<Popover.Portal>
								<Popover.Content
									class="menu-content icon-popover"
									side="bottom"
									align="start"
									sideOffset={8}
									collisionPadding={12}
								>
									<div class="icon-popover-head">
										<label class="folder-sheet-filter"
											><Search /><input
												bind:value={iconFilter}
												placeholder="Search icons"
												aria-label="Search icons"
												autocomplete="off"
												spellcheck="false"
												onkeydown={(e) => {
													if (e.key === 'Enter') e.preventDefault();
												}}
											/></label
										>
										{#if icon}<button
												type="button"
												class="icon-popover-remove"
												onclick={() => pick(null)}>Remove</button
											>{/if}
									</div>
									{#if catalog}{#if shownStickers.length}<div
												class="icon-popover-grid"
												role="group"
												aria-label="Icons"
											>
												{#each shownStickers as sticker (sticker.id)}<button
														type="button"
														class="icon-popover-option"
														aria-pressed={icon === sticker.id}
														aria-label={sticker.name}
														title={sticker.name}
														onclick={() => pick(sticker)}><Sticker {sticker} size={26} /></button
													>{/each}
											</div>{:else}<p class="icon-popover-note">No icon matches.</p>{/if}{:else}<p
											class="icon-popover-note"
										>
											Loading icons…
										</p>{/if}
								</Popover.Content>
							</Popover.Portal>
						</Popover.Root>
						<input
							bind:value={name}
							required
							maxlength="64"
							aria-label="Name"
							placeholder="Tech, Exploration…"
							autocomplete="off"
							spellcheck="false"
						/>
					</div>
					{#if taken}<p class="name-sheet-hint exists">A space by that name already exists.</p>{/if}
					{#if items.length}<div class="folder-sheet-tags" role="group" aria-label="In this space">
							<div class="folder-sheet-tags-head">
								<span
									>Shows{#if isDefault}<span class="space-default-note">
											· and anything not in another space</span
										>{/if}</span
								><small>{chosen.length}</small>
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
								><span>Delete {space.name}? Its tags go back to {defaultName}.</span><button
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
									disabled={lockedDefault}
									title={lockedDefault ? 'Make another space the default first' : undefined}
									onclick={() => (deleteArmed = true)}><Trash2 />Delete</button
								>{/if}{#if space && !isDefault}<button
									type="button"
									class="name-sheet-cancel space-make-default"
									onclick={async () => {
										if (!library) return;
										try {
											await setDefaultSpace(library, id);
											onSaved(`${space?.name} is now the default space.`);
										} catch (e) {
											error = (e as Error).message;
											onError(error);
										}
									}}>Make default</button
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
