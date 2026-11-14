<script lang="ts">
	import { Check, Search, Trash2, X as XIcon } from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import { untrack } from 'svelte';
	import type { Revision } from '#lib/domain/contracts.js';
	import { normalizeOrganizationName } from '#lib/domain/organization.js';
	import type { LibraryClient } from '#lib/client/vault/library.js';
	import { fileTags } from '#lib/client/workflows.js';
	import FolderGlyph from './ui/FolderGlyph.svelte';

	type Row = Record<string, unknown>;
	// Edits a folder: its name, and which tags sit inside it. Folders are made from the new-tag
	// popup (`name/`). A folder holds tags only, so deleting it lets its tags go loose again.
	let {
		open = $bindable(false),
		folder,
		armDelete = false,
		tags,
		folders,
		library,
		onSaved,
		onError
	}: {
		open?: boolean;
		folder: Row;
		// Opens straight onto the delete confirmation (from the folder's menu).
		armDelete?: boolean;
		tags: Row[];
		folders: Row[];
		library: LibraryClient | null;
		onSaved: (message: string) => void;
		onError: (message: string) => void;
	} = $props();

	let name = $state(''),
		chosen = $state<string[]>([]),
		filter = $state(''),
		busy = $state(false),
		deleteArmed = $state(false),
		error = $state('');
	const folderName = (id: unknown) => folders.find((f) => f.id === id)?.name;
	const members = () => tags.filter((t) => t.folderId === folder.id).map((t) => String(t.id));
	// Fresh each time the sheet opens, from the folder as it is now.
	$effect(() => {
		if (!open) return;
		// Only opening resets the sheet; a sync landing meanwhile must not undo the choices.
		untrack(() => {
			name = String(folder.name);
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
			folders.some((f) => f.id !== folder.id && normalized(String(f.name)) === normalized(name))
	);
	const needle = $derived(filter.trim().replace(/^#/, '').toLocaleLowerCase());
	const visible = $derived(
		needle ? tags.filter((t) => String(t.name).toLocaleLowerCase().includes(needle)) : tags
	);
	const changed = $derived(
		name.trim() !== String(folder.name) || [...chosen].sort().join() !== members().sort().join()
	);
	function toggle(id: string) {
		chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!library || busy || taken || !name.trim()) return;
		busy = true;
		error = '';
		try {
			const id = String(folder.id);
			if (name.trim() !== String(folder.name)) {
				const current = library.get<Row>('folders', id) ?? folder;
				const result = await library.save({
					type: 'folder.rename',
					id,
					expectedRevision: String(current.revision) as Revision,
					name
				});
				if (result.status === 'rejected')
					throw new Error(result.message ?? 'Could not save this folder.');
			}
			const before = new Set(members());
			await fileTags(
				library,
				chosen.filter((t) => !before.has(t)),
				id
			);
			await fileTags(
				library,
				[...before].filter((t) => !chosen.includes(t)),
				null
			);
			open = false;
			onSaved('Folder saved.');
		} catch (e) {
			error = (e as Error).message;
			onError(error);
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (!library || busy) return;
		busy = true;
		try {
			const current = library.get<Row>('folders', String(folder.id)) ?? folder;
			const result = await library.save({
				type: 'folder.delete',
				id: String(folder.id),
				expectedRevision: String(current.revision) as Revision
			});
			if (result.status === 'rejected')
				throw new Error(result.message ?? 'Could not delete this folder.');
			open = false;
			onSaved('Folder deleted. Its tags are loose again.');
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
			class="dialog-content name-sheet folder-sheet"
		>
			<header class="name-sheet-head">
				<Dialog.Title class="name-sheet-title">Edit folder</Dialog.Title>
				<Dialog.Close class="icon-button name-sheet-close" disabled={busy} aria-label="Close folder"
					><XIcon /></Dialog.Close
				>
			</header>
			<Dialog.Description class="sr-only"
				>Rename this folder, choose the tags it holds, or delete it. Bookmarks stay on their tags.</Dialog.Description
			>
			<form class="name-sheet-form" onsubmit={save}>
				<fieldset disabled={busy}>
					<label class="name-sheet-name">
						<span class="sr-only">Name</span>
						<span class="name-sheet-glyph"><FolderGlyph open /></span>
						<input
							bind:value={name}
							required
							maxlength="64"
							placeholder="folder-name"
							autocomplete="off"
							spellcheck="false"
						/>
					</label>
					{#if taken}<p class="name-sheet-hint exists">
							A folder by that name already exists.
						</p>{/if}
					{#if tags.length}<div
							class="folder-sheet-tags"
							role="group"
							aria-label="Tags in this folder"
						>
							<div class="folder-sheet-tags-head">
								<span>Tags inside</span><small>{chosen.length}</small>
								{#if tags.length > 12}<label class="folder-sheet-filter"
										><Search /><input
											bind:value={filter}
											placeholder="Find"
											aria-label="Find a tag"
											autocomplete="off"
											spellcheck="false"
											onkeydown={(e) => {
												// Enter here filters, it does not submit the sheet.
												if (e.key === 'Enter') e.preventDefault();
											}}
										/></label
									>{/if}
							</div>
							<div class="folder-sheet-chips">
								{#each visible as tag (String(tag.id))}
									{@const id = String(tag.id)}
									{@const elsewhere =
										tag.folderId && tag.folderId !== folder.id
											? folderName(tag.folderId)
											: undefined}
									<button
										type="button"
										class="folder-chip"
										aria-pressed={chosen.includes(id)}
										title={elsewhere && !chosen.includes(id)
											? `In ${elsewhere}; choosing it moves it here`
											: undefined}
										onclick={() => toggle(id)}
										>{#if chosen.includes(id)}<Check />{:else}<span aria-hidden="true">#</span
											>{/if}{tag.name}{#if elsewhere && !chosen.includes(id)}<small
												>{elsewhere}</small
											>{/if}</button
									>
								{:else}<p class="folder-sheet-none">No tag by that name.</p>{/each}
							</div>
						</div>{:else}<p class="name-sheet-hint">
							No tags yet. Make a few, then gather them here.
						</p>{/if}
					{#if error}<p class="form-error" role="alert">{error}</p>{/if}
					<footer class="name-sheet-actions">
						{#if deleteArmed}<span class="name-sheet-confirm"
								><span>Delete {folder.name}? Its tags stay.</span><button
									type="button"
									class="name-sheet-cancel"
									onclick={() => (deleteArmed = false)}>Keep</button
								><button
									type="button"
									class="name-sheet-danger"
									data-cuelume-warning
									onclick={() => void remove()}>Delete</button
								></span
							>{:else}<button
								type="button"
								class="name-sheet-delete"
								onclick={() => (deleteArmed = true)}><Trash2 />Delete</button
							><button
								type="submit"
								class="name-sheet-submit"
								disabled={busy || !name.trim() || taken || !changed}
								>{busy ? 'Saving…' : 'Save'}</button
							>{/if}
					</footer>
				</fieldset>
			</form>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
