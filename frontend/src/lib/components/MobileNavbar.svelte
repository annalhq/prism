<script lang="ts">
	import { Bookmark, Folder, Search, Cog, X } from '@lucide/svelte';
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

<nav class="mobile-navbar" class:searching aria-label="Mobile navigation">
	<div class="mobile-navbar-buttons" inert={searching}>
		<button
			class="mobile-nav-item"
			class:active={view === 'all'}
			aria-current={view === 'all' ? 'page' : undefined}
			onclick={() => onSelect('all')}><Bookmark /><span>Home</span></button
		>
		<button
			class="mobile-nav-item"
			class:active={browsing}
			aria-current={view === 'tags' ? 'page' : undefined}
			onclick={() => onSelect('tags')}><Folder /><span>Tags</span></button
		>
		<button class="mobile-nav-item account-button" onclick={onAccount} data-cuelume-open
			><Cog /><span>Settings</span></button
		>
		<button class="mobile-nav-search" aria-label="Search and add bookmarks" onclick={onSearch}
			><Search /></button
		>
	</div>
	<div class="mobile-navbar-omnibar" inert={!searching}>
		{@render omnibar()}
		<button class="mobile-nav-close" aria-label="Close search" onclick={() => (searching = false)}
			><X /></button
		>
	</div>
</nav>
