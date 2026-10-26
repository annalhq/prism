<script lang="ts">
	import {
		Bookmark,
		Clock3,
		Users,
		Trash2,
		Folder,
		PanelLeft,
		PanelRight,
		Plus,
		Settings2
	} from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import Brand from './ui/Brand.svelte';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		collapsed = $bindable(false),
		onSelect,
		onCreate,
		onAccount
	}: {
		view: string;
		tags: Row[];
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
		if (collapsed) toggle();
		await tick();
		document
			.querySelector<HTMLButtonElement>('.library-sidebar .sidebar-navigation button')
			?.focus();
	}
</script>

<aside class="library-sidebar" class:collapsed>
	<div class="sidebar-brand">
		<Brand compact /><span class="sidebar-label">prism</span>
		<button
			class="icon-button sidebar-toggle"
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={!collapsed}
			onclick={toggle}
			>{#if collapsed}<PanelLeft />{:else}<PanelRight />{/if}</button
		>
	</div>
	<nav class="sidebar-navigation" aria-label="Library">
		<button
			class="sidebar-link"
			title="Add bookmark · i"
			onclick={() => onCreate('bookmark')}
			data-cuelume-open><Plus /><span class="sidebar-label">Add bookmark</span></button
		>
		{#each views as item (item.id)}<button
				class="sidebar-link"
				class:active={view === item.id}
				aria-current={view === item.id ? 'page' : undefined}
				title={item.label}
				onclick={() => onSelect(item.id)}
				><item.icon /><span class="sidebar-label">{item.label}</span></button
			>{/each}
		<section class="sidebar-group">
			<div class="sidebar-section-heading">
				<button
					class="sidebar-heading-link"
					class:active={view === 'tags'}
					aria-current={view === 'tags' ? 'page' : undefined}
					title="Explore all tags"
					onclick={() => onSelect('tags')}>Tags</button
				><button class="icon-button" aria-label="Add tag" onclick={() => onCreate('tag')}
					><Plus /></button
				>
			</div>
			{#each tags as row (String(row.id))}<button
					class="sidebar-link"
					class:active={view === `tag:${row.id}`}
					aria-current={view === `tag:${row.id}` ? 'page' : undefined}
					title={String(row.name)}
					onclick={() => onSelect(`tag:${row.id}`)}
					><Folder /><span class="sidebar-label">{row.name}</span></button
				>{:else}<p class="sidebar-empty">A little room to organize.</p>{/each}
		</section>
	</nav>
	<button
		class="sidebar-link sidebar-account account-button"
		title="Account and preferences"
		onclick={onAccount}
		data-cuelume-open><Settings2 /><span class="sidebar-label">Account & preferences</span></button
	>
</aside>
