<script lang="ts">
	import { Bookmark, Folder, Cog, X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	let {
		view,
		searching = $bindable(false),
		onSelect,
		onAccount,
		onSearch,
		omnibar
	}: {
		view: string;
		searching?: boolean;
		onSelect: (value: string) => void;
		onAccount: () => void;
		onSearch: () => void;
		omnibar: Snippet;
	} = $props();
	// Every shelf and tag folder is reached through the tags page.
	const browsing = $derived(view !== 'all');
</script>

<!-- The search circle grows into the omnibar itself; its search icon becomes the field's leading icon. -->
<nav class="mobile-navbar" class:searching aria-label="Mobile navigation">
	<div class="mobile-nav-pill" inert={searching}>
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
		<button
			class="mobile-nav-item account-button"
			aria-label="Settings"
			onclick={onAccount}
			data-cuelume-open><Cog /></button
		>
	</div>
	<div class="mobile-search">
		<div class="mobile-search-field" inert={!searching}>{@render omnibar()}</div>
		{#if searching}<button
				class="mobile-search-close"
				aria-label="Close search"
				onclick={() => (searching = false)}><X /></button
			>{:else}<button
				class="mobile-search-trigger"
				aria-label="Search and add bookmarks"
				onclick={onSearch}
			></button>{/if}
	</div>
</nav>
