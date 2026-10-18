<script lang="ts">
	import {
		Bookmark,
		Clock3,
		Pin,
		Users,
		Archive,
		Trash2,
		Folder,
		Search,
		PanelLeftClose,
		PanelLeftOpen,
		Plus,
		Settings2,
		X
	} from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import { onMount } from 'svelte';
	import Brand from './ui/Brand.svelte';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		collections,
		saved,
		mobileOpen = $bindable(false),
		collapsed = $bindable(false),
		onSelect,
		onCreate,
		onAccount
	}: {
		view: string;
		tags: Row[];
		collections: Row[];
		saved: Row[];
		mobileOpen?: boolean;
		collapsed?: boolean;
		onSelect: (value: string) => void;
		onCreate: (type: string) => void;
		onAccount: () => void;
	} = $props();
	const views = [
		{ id: 'all', label: 'All bookmarks', icon: Bookmark },
		{ id: 'later', label: 'Read later', icon: Clock3 },
		{ id: 'pinned', label: 'Pinned', icon: Pin },
		{ id: 'people', label: 'People', icon: Users },
		{ id: 'archive', label: 'Archive', icon: Archive },
		{ id: 'trash', label: 'Trash', icon: Trash2 }
	];
	onMount(() => {
		try {
			const preference = localStorage.getItem('prism:sidebar');
			collapsed = preference ? preference === 'collapsed' : innerWidth < 1100;
		} catch {
			collapsed = innerWidth < 1100;
		}
	});
	function toggle() {
		collapsed = !collapsed;
		try {
			localStorage.setItem('prism:sidebar', collapsed ? 'collapsed' : 'expanded');
		} catch {
			/* Optional preference. */
		}
	}
	function select(value: string) {
		mobileOpen = false;
		onSelect(value);
	}
</script>

{#snippet navigation(mobile: boolean)}
	<div class="sidebar-brand">
		<Brand compact /><span class="sidebar-label">Prism <small>Personal library</small></span>
		<button
			class="icon-button sidebar-toggle"
			aria-label={mobile ? 'Close navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={mobile || !collapsed}
			onclick={() => (mobile ? (mobileOpen = false) : toggle())}
			>{#if mobile}<X />{:else if collapsed}<PanelLeftOpen />{:else}<PanelLeftClose />{/if}</button
		>
	</div>
	<nav class="sidebar-navigation" aria-label="Library">
		{#each views as item (item.id)}<button
				class="sidebar-link"
				class:active={view === item.id}
				aria-current={view === item.id ? 'page' : undefined}
				title={item.label}
				onclick={() => select(item.id)}
				><item.icon /><span class="sidebar-label">{item.label}</span></button
			>{/each}
		{#each [{ label: 'Tags', type: 'tag', rows: tags }, { label: 'Collections', type: 'collection', rows: collections }, { label: 'Saved searches', type: 'saved', rows: saved }] as group (group.type)}
			<section class="sidebar-group">
				<div class="sidebar-section-heading">
					<span>{group.label}</span>{#if group.type !== 'saved'}<button
							class="icon-button"
							aria-label={`Add ${group.type}`}
							onclick={() => {
								mobileOpen = false;
								onCreate(group.type);
							}}><Plus /></button
						>{/if}
				</div>
				{#each group.rows as row (String(row.id))}<button
						class="sidebar-link"
						class:active={view === `${group.type}:${row.id}`}
						aria-current={view === `${group.type}:${row.id}` ? 'page' : undefined}
						title={String(row.name)}
						onclick={() => select(`${group.type}:${row.id}`)}
						>{#if group.type === 'saved'}<Search />{:else}<Folder />{/if}<span class="sidebar-label"
							>{row.name}</span
						></button
					>{:else}<p class="sidebar-empty">
						{group.type === 'saved' ? 'Save a search to revisit it.' : 'A little room to organize.'}
					</p>{/each}
			</section>
		{/each}
	</nav>
	<button
		class="sidebar-link sidebar-account account-button"
		title="Account and preferences"
		onclick={() => {
			mobileOpen = false;
			onAccount();
		}}
		data-cuelume-open><Settings2 /><span class="sidebar-label">Account & preferences</span></button
	>
{/snippet}
<aside class="library-sidebar" class:collapsed>{@render navigation(false)}</aside>
<Dialog.Root bind:open={mobileOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay navigation-overlay" /><Dialog.Content
			class="mobile-navigation"
			><Dialog.Title class="sr-only">Library navigation</Dialog.Title><Dialog.Description
				class="sr-only">Browse your bookmarks, people, and folders.</Dialog.Description
			>{@render navigation(true)}</Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
