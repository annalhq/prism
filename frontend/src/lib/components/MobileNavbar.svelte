<script lang="ts">
	import { Bookmark, Folder, Cog } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	let {
		view,
		searching = $bindable(false),
		onSelect,
		onAccount,
		onSearch,
		omnibar,
		searchLabel = 'Search and add bookmarks'
	}: {
		view: string;
		searching?: boolean;
		onSelect: (value: string) => void;
		onAccount?: () => void;
		onSearch: () => void;
		omnibar: Snippet;
		searchLabel?: string;
	} = $props();
	// Every shelf and tag folder is reached through the tags page.
	const browsing = $derived(view !== 'all');
</script>

<!-- The search circle grows into the omnibar itself; its search icon becomes the field's leading icon. -->
<nav class="mobile-navbar" class:searching aria-label="Mobile navigation">
	<div
		class="mobile-nav-pill"
		inert={searching}
		style={`--tab-index: ${browsing ? 1 : 0}; --tab-count: ${onAccount ? 3 : 2}`}
	>
		<span class="mobile-nav-indicator" aria-hidden="true"></span>
		<button
			class="mobile-nav-item"
			class:active={view === 'all'}
			aria-label="All bookmarks"
			aria-current={view === 'all' ? 'page' : undefined}
			onclick={() => onSelect('all')}><Bookmark /></button
		>
		<button
			class="mobile-nav-item"
			class:active={browsing}
			aria-label="Tags and shelves"
			aria-current={view === 'tags' ? 'page' : undefined}
			onclick={() => onSelect('tags')}><Folder /></button
		>
		{#if onAccount}<button
				class="mobile-nav-item account-button"
				aria-label="Settings"
				onclick={onAccount}
				data-cuelume-open><Cog /></button
			>{/if}
	</div>
	<div class="mobile-search">
		<div class="mobile-search-field" inert={!searching}>{@render omnibar()}</div>
		<!-- Closing lives inside the omnibar's own trailing control, so there is only one ×. -->
		{#if !searching}<button
				class="mobile-search-trigger"
				aria-label={searchLabel}
				onclick={onSearch}
			></button>{/if}
	</div>
</nav>
