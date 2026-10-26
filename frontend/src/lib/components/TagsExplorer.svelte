<script lang="ts">
	import { Clock3, Folder, Plus, Search, Trash2, Users, X } from '@lucide/svelte';
	type Row = Record<string, unknown>;
	let {
		tags,
		counts,
		shelves,
		onSelect,
		onCreate
	}: {
		tags: Row[];
		counts: Record<string, number>;
		shelves: { later: number; people: number; trash: number };
		onSelect: (value: string) => void;
		onCreate: (name: string) => void;
	} = $props();
	let filter = $state(''),
		order = $state<'used' | 'name'>('used');
	let searchInput = $state<HTMLInputElement>();
	const needle = $derived(filter.trim().toLocaleLowerCase());
	const visible = $derived(
		tags
			.filter((t) => String(t.name).toLocaleLowerCase().includes(needle))
			.sort((a, b) =>
				order === 'used'
					? (counts[String(b.id)] ?? 0) - (counts[String(a.id)] ?? 0) ||
						String(a.name).localeCompare(String(b.name))
					: String(a.name).localeCompare(String(b.name))
			)
	);
	const exact = $derived(tags.some((t) => String(t.name).toLocaleLowerCase() === needle));
	export function focusSearch() {
		searchInput?.focus();
	}
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<section class="tags-explorer" aria-labelledby="tags-explorer-title">
	<div class="shelves" aria-label="Shelves">
		<button class="shelf" onclick={() => onSelect('later')}
			><span class="shelf-icon"><Clock3 /></span><span
				><strong>Read later</strong><small>{plural(shelves.later, 'link')} queued</small></span
			></button
		>
		<button class="shelf" onclick={() => onSelect('people')}
			><span class="shelf-icon"><Users /></span><span
				><strong>People</strong><small
					>{shelves.people === 1 ? '1 person' : `${shelves.people} people`}</small
				></span
			></button
		>
		<button class="shelf shelf-quiet" onclick={() => onSelect('trash')}
			><span class="shelf-icon"><Trash2 /></span><span
				><strong>Trash</strong><small
					>{shelves.trash ? `${shelves.trash} to review` : 'Empty'}</small
				></span
			></button
		>
	</div>

	<div class="tags-explorer-heading">
		<h2 id="tags-explorer-title">Tags <span class="muted">{tags.length}</span></h2>
		<label class="tags-filter">
			<Search /><input
				bind:this={searchInput}
				bind:value={filter}
				placeholder="Filter tags"
				aria-label="Filter tags"
				autocomplete="off"
				spellcheck="false"
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
					class="tags-filter-clear"
					aria-label="Clear tag filter"
					onclick={() => (filter = '')}><X /></button
				>{/if}
		</label>
		<button
			class="column-sort"
			aria-label="Sort tags"
			onclick={() => (order = order === 'used' ? 'name' : 'used')}
			>{order === 'used' ? 'Most used' : 'A–Z'}</button
		>
		<button class="text-button" onclick={() => onCreate('')}><Plus /> New tag</button>
	</div>

	<div class="tag-grid">
		{#each visible as row (String(row.id))}<button
				class="tag-tile"
				onclick={() => onSelect(`tag:${row.id}`)}
				><Folder /><span class="tag-tile-name">{row.name}</span><small
					>{counts[String(row.id)] ?? 0}</small
				></button
			>{/each}
		{#if needle && !exact}<button
				class="tag-tile tag-tile-new"
				onclick={() => onCreate(filter.trim())}
				><Plus /><span class="tag-tile-name">Create “{filter.trim()}”</span></button
			>{/if}
	</div>
	{#if !tags.length}<p class="tags-empty muted">
			Tags group related links. Create one, or add tags while saving a bookmark.
		</p>{/if}
</section>
