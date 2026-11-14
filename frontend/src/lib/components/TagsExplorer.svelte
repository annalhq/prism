<script lang="ts">
	import { ChevronRight, Clock3, Hash, Plus, Search, Trash2, Users, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import FolderGlyph from './ui/FolderGlyph.svelte';
	import FolderMenu from './FolderMenu.svelte';
	import {
		closedFolders,
		groupTags,
		restoreFolders,
		setFolderOpen
	} from '#lib/client/folders.svelte.js';
	type Row = Record<string, unknown>;
	let {
		tags,
		folders = [],
		counts,
		shelves,
		onSelect,
		onCreate,
		onEditFolder
	}: {
		tags: Row[];
		folders?: Row[];
		counts: Record<string, number>;
		shelves: { later: number; people: number; trash: number };
		onSelect: (value: string) => void;
		// Absent on the public page, which shows tags without letting anyone add them.
		onCreate?: (name: string) => void;
		// The folder sheet (rename, choose tags, delete), from a folder's context menu.
		onEditFolder?: (folder: Row, intent?: 'delete') => void;
	} = $props();
	onMount(restoreFolders);
	let filter = $state(''),
		order = $state<'used' | 'name' | 'custom'>('used');
	let searchInput = $state<HTMLInputElement>();
	const name = $derived(filter.trim().replace(/^#/, ''));
	const needle = $derived(name.toLocaleLowerCase());
	const visible = $derived(
		tags
			.filter((t) => String(t.name).toLocaleLowerCase().includes(needle))
			// `tags` arrives in the user's own order, which the stable sort keeps for 'custom'.
			.sort((a, b) =>
				order === 'used'
					? (counts[String(b.id)] ?? 0) - (counts[String(a.id)] ?? 0) ||
						String(a.name).localeCompare(String(b.name))
					: order === 'name'
						? String(a.name).localeCompare(String(b.name))
						: 0
			)
	);
	// Unfiltered, tags sit under their folders (each in the chosen order); a search lists every
	// match flat, naming the folder it came from.
	const grouped = $derived(groupTags(visible, folders));
	const folderName = $derived(new Map(folders.map((f) => [String(f.id), String(f.name)])));
	const exact = $derived(tags.some((t) => String(t.name).toLocaleLowerCase() === needle));
	const orderLabel = { used: 'Most used', name: 'A–Z', custom: 'Your order' } as const;
	export function focusSearch() {
		searchInput?.focus();
	}
</script>

<section class="tags-explorer" aria-label="Tags and shelves">
	<nav class="shelves" aria-label="Shelves">
		<button class="shelf" onclick={() => onSelect('later')}
			><Clock3 /><span>Read later</span>{#if shelves.later}<small>{shelves.later}</small
				>{/if}</button
		>
		<button class="shelf" onclick={() => onSelect('people')}
			><Users /><span>People</span>{#if shelves.people}<small>{shelves.people}</small>{/if}</button
		>
		{#if onCreate}<button class="shelf" onclick={() => onSelect('trash')}
				><Trash2 /><span>Trash</span>{#if shelves.trash}<small>{shelves.trash}</small>{/if}</button
			>{/if}
	</nav>

	<div class="tags-head">
		<label class="tags-search">
			<Search /><input
				bind:this={searchInput}
				bind:value={filter}
				placeholder="Find a tag"
				aria-label="Find a tag"
				autocomplete="off"
				spellcheck="false"
				enterkeyhint="go"
				onkeydown={(e) => {
					if (e.key === 'Escape' && filter) {
						e.preventDefault();
						e.stopPropagation();
						filter = '';
					} else if (e.key === 'Enter' && visible[0]) {
						e.preventDefault();
						onSelect(`tag:${visible[0].id}`);
					}
				}}
			/>{#if filter}<button
					type="button"
					class="tags-search-clear"
					aria-label="Clear tag filter"
					onclick={() => {
						filter = '';
						searchInput?.focus();
					}}><X /></button
				>{/if}
		</label>
		<h2>
			{needle ? 'Matching tags' : 'Tags'}<span>{needle ? visible.length : tags.length}</span>
		</h2>
		{#if tags.length > 1}<button
				class="column-sort"
				aria-label={`Sort tags: ${orderLabel[order]}`}
				onclick={() => (order = order === 'used' ? 'name' : order === 'name' ? 'custom' : 'used')}
				>{orderLabel[order]}</button
			>{/if}
		{#if onCreate}<button
				class="icon-button tags-new"
				aria-label="New tag or folder"
				title="New tag · end with / for a folder"
				onclick={() => onCreate('')}><Plus /></button
			>{/if}
	</div>

	{#if !needle && grouped.groups.length}<div class="tag-folders">
			{#each grouped.groups as group (String(group.folder.id))}
				{@const id = String(group.folder.id)}
				{@const open = !closedFolders.has(id)}
				<section class={['tag-folder', open && 'open']}>
					{#snippet head()}<button
							class="tag-folder-toggle"
							aria-expanded={open}
							onclick={() => setFolderOpen(id, !open)}
							><FolderGlyph {open} /><span>{group.folder.name}</span><small
								>{group.tags.length} {group.tags.length === 1 ? 'tag' : 'tags'}</small
							></button
						>{/snippet}
					{#if onEditFolder}<FolderMenu
							folder={group.folder}
							onEdit={onEditFolder}
							onCreateIn={onCreate && ((folder) => onCreate(`${folder.name}/`))}
							class="tag-folder-head">{@render head()}</FolderMenu
						>{:else}<div class="tag-folder-head">{@render head()}</div>{/if}
					<div class="tag-folder-body" data-open={open} inert={!open}>
						<div>
							{#if group.tags.length}<ul class="tag-list">
									{#each group.tags as row (String(row.id))}<li>{@render tagRow(row)}</li>{/each}
								</ul>{:else}<p class="tags-empty tag-folder-empty">
									{onEditFolder ? 'Empty. Right-click the folder to choose its tags.' : 'Empty.'}
								</p>{/if}
						</div>
					</div>
				</section>
			{/each}
		</div>{/if}

	{#if (needle ? visible : grouped.loose).length || (onCreate && needle && !exact)}<ul
			class="tag-list"
		>
			{#each needle ? visible : grouped.loose as row, index (String(row.id))}<li
					style:--i={Math.min(index, 12)}
				>
					{@render tagRow(row, needle ? folderName.get(String(row.folderId)) : undefined)}
				</li>{/each}
			{#if onCreate && needle && !exact}<li>
					<button class="tag-row tag-row-new" onclick={() => onCreate(name)}
						><Plus /><span
							>{name.endsWith('/') ? `Create folder ${name.slice(0, -1)}` : `Create #${name}`}</span
						></button
					>
				</li>{/if}
		</ul>{:else if !grouped.groups.length || needle}<p class="tags-empty">
			{needle
				? 'No tag by that name.'
				: onCreate
					? 'Tags group related links. Add one here, or type #name while saving a link.'
					: 'No tags yet.'}
		</p>{/if}
</section>

{#snippet tagRow(row: Row, folder?: string)}<button
		class="tag-row"
		onclick={() => onSelect(`tag:${row.id}`)}
		><Hash /><span>{row.name}</span>{#if folder}<em class="tag-row-folder">{folder}</em>{/if}<small
			>{counts[String(row.id)] ?? 0}</small
		><ChevronRight class="tag-row-go" /></button
	>{/snippet}
