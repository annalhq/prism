<script lang="ts">
	import {
		Bookmark,
		Clock3,
		Users,
		Trash2,
		Folder,
		PanelLeftClose,
		PanelLeftOpen,
		Plus,
		Settings2,
		X
	} from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import { onMount, tick } from 'svelte';
	import Brand from './ui/Brand.svelte';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		mobileOpen = $bindable(false),
		collapsed = $bindable(false),
		onSelect,
		onCreate,
		onAccount
	}: {
		view: string;
		tags: Row[];
		mobileOpen?: boolean;
		collapsed?: boolean;
		onSelect: (value: string) => void;
		onCreate: (type: string) => void;
		onAccount: () => void;
	} = $props();
	const views = [
		{ id: 'all', label: 'All bookmarks', icon: Bookmark },
		{ id: 'later', label: 'Read later', icon: Clock3 },
		{ id: 'people', label: 'People', icon: Users },
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
	export async function focusNavigation() {
		if (innerWidth < 768) mobileOpen = true;
		else if (collapsed) toggle();
		await tick();
		document
			.querySelector<HTMLButtonElement>(
				`${mobileOpen ? '.mobile-navigation' : '.library-sidebar'} .sidebar-navigation button`
			)
			?.focus();
	}

	function select(value: string) {
		mobileOpen = false;
		onSelect(value);
	}
</script>

{#snippet navigation(mobile: boolean)}
	<div class="sidebar-brand">
		<Brand compact /><span class="sidebar-label">prism</span>
		<button
			class="icon-button sidebar-toggle"
			aria-label={mobile ? 'Close navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={mobile || !collapsed}
			onclick={() => (mobile ? (mobileOpen = false) : toggle())}
			>{#if mobile}<X />{:else if collapsed}<PanelLeftOpen />{:else}<PanelLeftClose />{/if}</button
		>
	</div>
	<nav class="sidebar-navigation" aria-label="Library">
		<button
			class="sidebar-link"
			title="Add bookmark · i"
			onclick={() => {
				mobileOpen = false;
				onCreate('bookmark');
			}}
			data-cuelume-open><Plus /><span class="sidebar-label">Add bookmark</span></button
		>
		{#each views as item (item.id)}<button
				class="sidebar-link"
				class:active={view === item.id}
				aria-current={view === item.id ? 'page' : undefined}
				title={item.label}
				onclick={() => select(item.id)}
				><item.icon /><span class="sidebar-label">{item.label}</span></button
			>{/each}
		<section class="sidebar-group">
			<div class="sidebar-section-heading">
				<span>Tags</span><button
					class="icon-button"
					aria-label="Add tag"
					onclick={() => {
						mobileOpen = false;
						onCreate('tag');
					}}><Plus /></button
				>
			</div>
			{#each tags as row (String(row.id))}<button
					class="sidebar-link"
					class:active={view === `tag:${row.id}`}
					aria-current={view === `tag:${row.id}` ? 'page' : undefined}
					title={String(row.name)}
					onclick={() => select(`tag:${row.id}`)}
					><Folder /><span class="sidebar-label">{row.name}</span></button
				>{:else}<p class="sidebar-empty">A little room to organize.</p>{/each}
		</section>
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
