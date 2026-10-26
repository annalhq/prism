<script lang="ts">
	import {
		Bookmark,
		Clock3,
		Folder,
		Plus,
		Search,
		Settings2,
		Trash2,
		Users,
		X
	} from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import { tick, type Snippet } from 'svelte';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		searching = $bindable(false),
		onSelect,
		onCreate,
		onAccount,
		onSearch,
		omnibar
	}: {
		view: string;
		tags: Row[];
		searching?: boolean;
		onSelect: (value: string) => void;
		onCreate: (type: string) => void;
		onAccount: () => void;
		onSearch: () => void;
		omnibar: Snippet;
	} = $props();
	let sheetOpen = $state(false);
	const views = [
		{ id: 'later', label: 'Read later', icon: Clock3 },
		{ id: 'people', label: 'People', icon: Users },
		{ id: 'trash', label: 'Trash', icon: Trash2 }
	];
	const browsing = $derived(view !== 'all');
	export async function focusTags() {
		searching = false;
		sheetOpen = true;
		await tick();
		document.querySelector<HTMLButtonElement>('.mobile-sheet .sidebar-link')?.focus();
	}
	function select(value: string) {
		sheetOpen = false;
		onSelect(value);
	}
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
			aria-haspopup="dialog"
			onclick={() => (sheetOpen = true)}
			data-cuelume-open><Folder /><span>Tags</span></button
		>
		<button class="mobile-nav-item account-button" onclick={onAccount} data-cuelume-open
			><Settings2 /><span>Settings</span></button
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

<Dialog.Root bind:open={sheetOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="mobile-sheet"
			><Dialog.Title class="sr-only">Browse library</Dialog.Title><Dialog.Description
				class="sr-only">Browse saved views and tag folders.</Dialog.Description
			>
			<div class="mobile-sheet-handle" aria-hidden="true"></div>
			<nav class="sidebar-navigation" aria-label="Library views">
				{#each views as item (item.id)}<button
						class="sidebar-link"
						class:active={view === item.id}
						aria-current={view === item.id ? 'page' : undefined}
						onclick={() => select(item.id)}><item.icon /><span>{item.label}</span></button
					>{/each}
				<section class="sidebar-group">
					<div class="sidebar-section-heading">
						<span>Tags</span><button
							class="icon-button"
							aria-label="Add tag"
							onclick={() => {
								sheetOpen = false;
								onCreate('tag');
							}}><Plus /></button
						>
					</div>
					{#each tags as row (String(row.id))}<button
							class="sidebar-link"
							class:active={view === `tag:${row.id}`}
							aria-current={view === `tag:${row.id}` ? 'page' : undefined}
							onclick={() => select(`tag:${row.id}`)}><Folder /><span>{row.name}</span></button
						>{:else}<p class="sidebar-empty">A little room to organize.</p>{/each}
				</section>
			</nav></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
