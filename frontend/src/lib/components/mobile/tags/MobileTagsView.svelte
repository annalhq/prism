<script lang="ts">
	import { ChevronRight, Clock3, Layers, Plus, Search, Trash2, Users, X } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { shelfSwap } from '#lib/client/motion.js';
	import { tagsPageFolders } from '#lib/client/folders.svelte.js';
	import {
		activeSpace,
		resolveSpaceId,
		restoreSpace,
		shelfFor,
		showSpace
	} from '#lib/client/spaces.svelte.js';
	import { ensureStickers } from '#lib/client/stickers.svelte.js';
	import { defaultSpaceId, groupTags, spaceOf } from '#lib/client/workflows.js';
	import SpaceEmpty from '../spaces/SpaceEmpty.svelte';
	import SpaceTabs from '../spaces/SpaceTabs.svelte';
	import MobileTagList from './MobileTagList.svelte';
	import MobileTagRow from './MobileTagRow.svelte';

	type Row = Record<string, unknown>;
	// The phone's tags page: shelves, a finder, then one space at a time, switched by tapping its
	// tab. Searching looks through every space at once. The desktop page is TagsExplorer.
	let {
		tags,
		folders = [],
		spaces = [],
		counts,
		shelves,
		onSelect,
		onCreate,
		onEditFolder,
		onEditSpace,
		onSetDefault,
		onReorderSpace
	}: {
		tags: Row[];
		folders?: Row[];
		spaces?: Row[];
		counts: Record<string, number>;
		shelves: { later: number; people: number; trash: number };
		onSelect: (value: string) => void;
		onCreate?: (name: string) => void;
		onEditFolder?: (folder: Row, intent?: 'delete') => void;
		// The space sheet: null makes a new space; `delete` opens with deleting armed.
		onEditSpace?: (space: Row | null, intent?: 'delete') => void;
		onSetDefault?: (id: string) => void | Promise<void>;
		onReorderSpace?: (id: string, toIndex: number) => void | Promise<void>;
	} = $props();

	const PANEL_ID = 'mobile-space-panel';
	let root = $state<HTMLElement>(),
		searchInput = $state<HTMLInputElement>(),
		filter = $state(''),
		order = $state<'used' | 'name' | 'custom'>('used'),
		// Which way the last switch went, so the list travels with the tabs.
		direction = $state(0);

	onMount(() => {
		restoreSpace();
		tagsPageFolders.restore();
	});
	const icons = $derived(
		spaces.map((s) => s.icon).filter((icon): icon is string => typeof icon === 'string')
	);
	$effect(() => {
		if (icons.length) void ensureStickers(icons);
	});

	const name = $derived(filter.trim().replace(/^#/, ''));
	const needle = $derived(name.toLocaleLowerCase());
	// `tags` arrives in the user's own order, which the stable sort keeps for 'custom'.
	const sorted = $derived(
		[...tags].sort((a, b) =>
			order === 'used'
				? (counts[String(b.id)] ?? 0) - (counts[String(a.id)] ?? 0) ||
					String(a.name).localeCompare(String(b.name))
				: order === 'name'
					? String(a.name).localeCompare(String(b.name))
					: 0
		)
	);
	const matches = $derived(
		sorted.filter((t) => String(t.name).toLocaleLowerCase().includes(needle))
	);
	const exact = $derived(tags.some((t) => String(t.name).toLocaleLowerCase() === needle));
	const orderLabel = { used: 'Most used', name: 'A–Z', custom: 'Your order' } as const;

	const defaultId = $derived(defaultSpaceId(spaces));
	const spaceId = $derived(resolveSpaceId(spaces, activeSpace.id));
	const space = $derived(spaces.find((s) => String(s.id) === spaceId));
	// With no spaces, everything is one shelf.
	const shelf = $derived(
		space ? shelfFor(spaceId, sorted, folders, spaces) : groupTags(sorted, folders)
	);
	const shelfCount = $derived(
		shelf.loose.length + shelf.groups.reduce((sum, g) => sum + g.tags.length, 0)
	);
	const searching = $derived(!!needle);
	const count = $derived(searching ? matches.length : space ? shelfCount : tags.length);

	// A search result says where the tag lives, since the list around it doesn't.
	const folderName = $derived(new Map(folders.map((f) => [String(f.id), String(f.name)])));
	const spaceName = $derived(new Map(spaces.map((s) => [String(s.id), String(s.name)])));
	function whereOf(tag: Row) {
		const folder = folderName.get(String(tag.folderId));
		const home = spaces.length > 1 ? spaceName.get(spaceOf(tag, folders, spaces)) : undefined;
		const parts = [home && `in ${home}`, folder].filter(Boolean);
		return parts.length ? parts.join(' · ') : undefined;
	}

	// Tapping a tab. If the tabs are pinned (the list is scrolled), the new space starts from
	// its top, just under them, rather than somewhere in its middle.
	function select(id: string) {
		if (id === spaceId) return;
		const from = spaces.findIndex((s) => String(s.id) === spaceId),
			to = spaces.findIndex((s) => String(s.id) === id);
		direction = Math.sign(to - from);
		showSpace(id);
		const scroller = root?.closest<HTMLElement>('.library-content');
		const bar = root?.querySelector<HTMLElement>('.space-tabs');
		const panel = root?.querySelector<HTMLElement>(`#${PANEL_ID}`);
		if (!scroller || !bar || !panel) return;
		const gap = panel.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
		if (gap < 0)
			scroller.scrollTo({
				top: scroller.scrollTop + gap - 8,
				behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
			});
	}

	export async function focusSearch() {
		await tick();
		searchInput?.focus();
	}
</script>

<section class="tags-explorer mobile-tags" aria-label="Tags and shelves" bind:this={root}>
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

	<!-- The finder sits above the tabs, so the field never moves while the tabs fold away. -->
	<label class="tags-search">
		<Search /><input
			bind:this={searchInput}
			bind:value={filter}
			placeholder={spaces.length > 1 ? 'Find a tag in any space' : 'Find a tag'}
			aria-label="Find a tag"
			autocomplete="off"
			spellcheck="false"
			enterkeyhint="go"
			onkeydown={(e) => {
				if (e.key === 'Escape' && filter) {
					e.preventDefault();
					e.stopPropagation();
					filter = '';
				} else if (e.key === 'Enter' && matches[0]) {
					e.preventDefault();
					onSelect(`tag:${matches[0].id}`);
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

	{#if spaces.length}<SpaceTabs
			{spaces}
			current={spaceId}
			{defaultId}
			panelId={PANEL_ID}
			hidden={searching}
			onSelect={select}
			{onEditSpace}
			{onSetDefault}
			{onReorderSpace}
		/>{:else if onEditSpace}<button class="spaces-intro" onclick={() => onEditSpace(null)}
			><span class="spaces-intro-icon"><Layers /></span><span class="spaces-intro-text"
				><strong>Organize with spaces</strong><small
					>Group tags and folders into shelves you switch between</small
				></span
			><ChevronRight class="spaces-intro-go" /></button
		>{/if}

	<div class="tags-head">
		<h2>
			{searching ? 'Matching tags' : (space?.name ?? 'Tags')}{#key count}<span
					in:fade={{ duration: 160 }}>{count}</span
				>{/key}
		</h2>
		{#if tags.length > 1}<button
				class="column-sort"
				aria-label={`Sort tags: ${orderLabel[order]}`}
				onclick={() => (order = order === 'used' ? 'name' : order === 'name' ? 'custom' : 'used')}
				>{orderLabel[order]}</button
			>{/if}
		{#if onCreate}<button
				class="icon-button tags-new"
				aria-label={space ? `New tag in ${space.name}` : 'New tag or folder'}
				onclick={() => onCreate('')}><Plus /></button
			>{/if}
	</div>

	<div
		class="space-panel"
		id={PANEL_ID}
		role={spaces.length ? 'tabpanel' : undefined}
		aria-label={searching ? 'Matching tags' : String(space?.name ?? 'Tags')}
	>
		{#key searching ? '' : spaceId}
			<div
				class="space-page"
				in:shelfSwap={{ direction: searching ? 0 : direction }}
				out:shelfSwap={{ direction: searching ? 0 : direction, leaving: true }}
			>
				{#if searching}
					{#if matches.length || (onCreate && !exact)}<ul class="tag-list">
							{#each matches as row, index (String(row.id))}<li style:--i={Math.min(index, 8)}>
									<MobileTagRow
										tag={row}
										count={counts[String(row.id)] ?? 0}
										where={whereOf(row)}
										{onSelect}
									/>
								</li>{/each}
							{#if onCreate && !exact}<li>
									<button class="tag-row tag-row-new" onclick={() => onCreate(name)}
										><Plus /><span
											>{name.endsWith('/')
												? `Create folder ${name.slice(0, -1)}`
												: `Create #${name}`}</span
										></button
									>
								</li>{/if}
						</ul>{:else}<p class="tags-empty">No tag by that name.</p>{/if}
				{:else if shelf.groups.length || shelf.loose.length}<MobileTagList
						groups={shelf.groups}
						loose={shelf.loose}
						{counts}
						{onSelect}
						{onCreate}
						{onEditFolder}
					/>{:else if space}<SpaceEmpty
						{space}
						{onEditSpace}
						onCreate={onCreate && (() => onCreate(''))}
					/>{:else}<p class="tags-empty">
						{onCreate
							? 'Tags group related links. Add one here, or type #name while saving a link.'
							: 'No tags yet.'}
					</p>{/if}
			</div>
		{/key}
	</div>
</section>

<style>
	/* The outgoing and incoming lists share one cell, so a switch never stacks them. */
	.space-panel {
		display: grid;
	}
	.space-page {
		display: flex;
		flex-direction: column;
		grid-area: 1 / 1;
		gap: 16px;
		min-width: 0;
	}
	.mobile-tags .tags-head {
		margin-top: -6px;
	}
	.mobile-tags .tags-head h2 {
		min-width: 0;
	}
	.spaces-intro {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 60px;
		padding: 10px 12px;
		border-radius: var(--radius-card);
		background: var(--field);
		box-shadow: inset 0 0 0 1px var(--hairline);
		text-align: left;
		-webkit-tap-highlight-color: transparent;
		transition:
			background-color 120ms ease,
			scale 200ms var(--ease-spring);
	}
	.spaces-intro:active {
		background: var(--hover);
		scale: 0.98;
		transition-duration: 80ms;
	}
	.spaces-intro-icon {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-control);
		background: var(--surface);
		color: var(--secondary);
	}
	.spaces-intro-icon :global(svg) {
		width: 18px;
		height: 18px;
	}
	.spaces-intro-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.spaces-intro-text strong {
		color: var(--ink);
		font-size: var(--text-base);
		font-weight: 500;
	}
	.spaces-intro-text small {
		color: var(--tertiary);
		font-size: var(--text-sm);
	}
	.spaces-intro :global(.spaces-intro-go) {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		color: var(--tertiary);
	}
</style>
