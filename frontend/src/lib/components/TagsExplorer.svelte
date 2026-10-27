<script lang="ts">
	import { ChevronRight, Clock3, Hash, Plus, Search, Trash2, Users, X } from '@lucide/svelte';
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
		// Absent on the public page, which shows tags without letting anyone add them.
		onCreate?: (name: string) => void;
	} = $props();
	let filter = $state(''),
		order = $state<'used' | 'name' | 'custom'>('used');
	let searchInput = $state<HTMLInputElement>();
	const needle = $derived(filter.trim().replace(/^#/, '').toLocaleLowerCase());
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
				aria-label="New tag"
				title="New tag"
				onclick={() => onCreate('')}><Plus /></button
			>{/if}
	</div>

	{#if visible.length || (onCreate && needle && !exact)}<ul class="tag-list">
			{#each visible as row, index (String(row.id))}<li style:--i={Math.min(index, 12)}>
					<button class="tag-row" onclick={() => onSelect(`tag:${row.id}`)}
						><Hash /><span>{row.name}</span><small>{counts[String(row.id)] ?? 0}</small
						><ChevronRight class="tag-row-go" /></button
					>
				</li>{/each}
			{#if onCreate && needle && !exact}<li>
					<button
						class="tag-row tag-row-new"
						onclick={() => onCreate(filter.trim().replace(/^#/, ''))}
						><Plus /><span>Create #{filter.trim().replace(/^#/, '')}</span></button
					>
				</li>{/if}
		</ul>{:else}<p class="tags-empty">
			{needle
				? 'No tag by that name.'
				: onCreate
					? 'Tags group related links. Add one here, or type #name while saving a link.'
					: 'No tags yet.'}
		</p>{/if}
</section>
