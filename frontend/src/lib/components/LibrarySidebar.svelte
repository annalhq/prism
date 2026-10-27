<script lang="ts">
	import {
		Bookmark,
		Clock3,
		Users,
		Trash2,
		Hash,
		PanelLeft,
		PanelRight,
		Plus,
		Settings2,
		Eye
	} from '@lucide/svelte';
	import type { Attachment } from 'svelte/attachments';
	import { onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import Brand from './ui/Brand.svelte';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		collapsed = $bindable(false),
		home,
		counts,
		onSelect,
		onCreate,
		onAccount,
		onReorder
	}: {
		view: string;
		tags: Row[];
		collapsed?: boolean;
		home?: '/' | '/public';
		// Item counts beside each view and tag; absent until the library has loaded.
		counts?: {
			counts: Record<string, number>;
			shelves: { all: number; later: number; people: number; trash: number };
		};
		onSelect: (value: string) => void;
		// Without these the sidebar is view-only: no adding, no trash, no account.
		onCreate?: (type: string) => void;
		onAccount?: () => void;
		// Moves a tag to an index of the list without it; absent where tags are read-only.
		onReorder?: (id: string, toIndex: number) => void | Promise<void>;
	} = $props();
	// While dragging, `preview` is the order as it would be if dropped now. The list renders
	// it so the other folders slide aside under the pointer instead of jumping on drop.
	let dragId = $state(''),
		preview = $state<string[] | null>(null),
		committing = false,
		reduceMotion = $state(false);
	const shown = $derived.by(() => {
		if (!preview) return tags;
		const byId = new Map(tags.map((t) => [String(t.id), t]));
		const ordered = preview.map((id) => byId.get(id)).filter((t): t is Row => !!t);
		// A tag added mid-drag still shows, at the end.
		return [...ordered, ...tags.filter((t) => !preview!.includes(String(t.id)))];
	});
	function hover(event: DragEvent, id: string) {
		if (!dragId || !preview) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (id === dragId) return;
		const from = preview.indexOf(dragId),
			to = preview.indexOf(id);
		if (from === -1 || to === -1) return;
		// Swap only once the pointer passes the middle of the row in the direction of travel,
		// so a row sliding under a still pointer does not bounce straight back.
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const middle = box.top + box.height / 2;
		if ((from < to && event.clientY < middle) || (from > to && event.clientY > middle)) return;
		const next = preview.filter((x) => x !== dragId);
		next.splice(to, 0, dragId);
		preview = next;
	}
	async function finishDrag() {
		const id = dragId,
			order = preview;
		dragId = '';
		if (!id || !order) {
			preview = null;
			return;
		}
		const index = order.indexOf(id);
		committing = true;
		try {
			// Keep the previewed order until the saved one arrives, so nothing snaps back.
			if (index !== tags.findIndex((t) => t.id === id)) await onReorder?.(id, index);
		} finally {
			committing = false;
			preview = null;
		}
	}
	function cancelDrag() {
		dragId = '';
		if (!committing) preview = null;
	}
	async function nudge(event: KeyboardEvent, id: string) {
		if (!onReorder || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		const index = tags.findIndex((t) => t.id === id);
		const next = index + (event.key === 'ArrowUp' ? -1 : 1);
		if (index === -1 || next < 0 || next >= tags.length) return;
		await onReorder(id, next);
		await tick();
		document.querySelector<HTMLElement>(`.library-sidebar [data-tag-id="${id}"]`)?.focus();
	}
	const views = $derived(
		[
			{ id: 'all', label: 'All bookmarks', icon: Bookmark },
			{ id: 'later', label: 'Read later', icon: Clock3 },
			{ id: 'people', label: 'People', icon: Users },
			{ id: 'trash', label: 'Trash', icon: Trash2 }
		].filter((item) => onCreate || item.id !== 'trash')
	);
	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		reduceMotion = motion.matches;
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
	const countOf = (id: string) =>
		counts
			? id.startsWith('tag:')
				? counts.counts[id.slice(4)]
				: counts.shelves[id as keyof typeof counts.shelves]
			: undefined;
	// One highlight glides to whichever row is current, instead of each row lighting up on
	// its own. Re-runs when the view, the tag order or the panel width changes.
	function highlight(current: string, order: unknown, narrow: boolean): Attachment<HTMLElement> {
		return (nav) => {
			void order;
			void narrow;
			let frame = 0;
			// Measured from the rendered boxes, after layout, so nested groups and webfont
			// swaps can't throw it off.
			const place = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
					const box = active?.getBoundingClientRect();
					if (!active || !box?.height) {
						nav.dataset.indicator = 'off';
						return;
					}
					const top = box.top - nav.getBoundingClientRect().top + nav.scrollTop;
					nav.style.setProperty('--indicator-y', `${top}px`);
					nav.style.setProperty('--indicator-h', `${box.height}px`);
					nav.dataset.indicator = 'on';
				});
			};
			place();
			const observer = new ResizeObserver(place);
			observer.observe(nav);
			void document.fonts?.ready.then(place);
			return () => {
				cancelAnimationFrame(frame);
				observer.disconnect();
			};
		};
	}
	export async function focusNavigation() {
		if (collapsed) toggle();
		await tick();
		document
			.querySelector<HTMLButtonElement>('.library-sidebar .sidebar-navigation button')
			?.focus();
	}
</script>

<aside class={['library-sidebar', collapsed && 'collapsed']}>
	<div class="sidebar-brand">
		<Brand compact {home} /><span class="sidebar-label">prism</span>
		<button
			class="icon-button sidebar-toggle"
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={!collapsed}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			onclick={toggle}
			>{#if collapsed}<PanelLeft />{:else}<PanelRight />{/if}</button
		>
	</div>
	<nav
		class="sidebar-navigation"
		aria-label="Library"
		{@attach highlight(view, shown.map((t) => t.id).join(), collapsed)}
	>
		<span class="sidebar-indicator" aria-hidden="true"></span>
		{#each views as item (item.id)}<button
				class={['sidebar-link', view === item.id && 'active']}
				aria-current={view === item.id ? 'page' : undefined}
				title={item.label}
				onclick={() => onSelect(item.id)}
				><item.icon /><span class="sidebar-label">{item.label}</span>{#if countOf(item.id)}<small
						class="sidebar-count sidebar-label">{countOf(item.id)}</small
					>{/if}</button
			>{/each}
		<!-- Drops anywhere in the group, including gaps between rows, commit the preview. -->
		<section
			class="sidebar-group"
			role="group"
			aria-label="Tags"
			ondragover={(event) => {
				if (dragId) event.preventDefault();
			}}
			ondrop={(event) => {
				if (!dragId) return;
				event.preventDefault();
				void finishDrag();
			}}
		>
			<div class="sidebar-section-heading">
				<button
					class={['sidebar-heading-link', view === 'tags' && 'active']}
					aria-current={view === 'tags' ? 'page' : undefined}
					title="Explore all tags"
					onclick={() => onSelect('tags')}>Tags</button
				>{#if onCreate}<button
						class="icon-button"
						aria-label="Add tag"
						title="Add tag"
						onclick={() => onCreate('tag')}><Plus /></button
					>{/if}
			</div>
			{#each shown as row (String(row.id))}<button
					animate:flip={{ duration: reduceMotion ? 0 : 180 }}
					class={[
						'sidebar-link',
						view === `tag:${row.id}` && 'active',
						dragId === row.id && 'dragging'
					]}
					aria-current={view === `tag:${row.id}` ? 'page' : undefined}
					aria-keyshortcuts={onReorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
					title={onReorder ? `${row.name} · drag or Alt+↑/↓ to reorder` : String(row.name)}
					data-tag-id={String(row.id)}
					draggable={!!onReorder && !collapsed}
					ondragstart={(event) => {
						dragId = String(row.id);
						preview = tags.map((t) => String(t.id));
						if (event.dataTransfer) {
							event.dataTransfer.effectAllowed = 'move';
							event.dataTransfer.setData('text/plain', String(row.name));
						}
					}}
					ondragenter={(event) => hover(event, String(row.id))}
					ondragover={(event) => hover(event, String(row.id))}
					ondragend={cancelDrag}
					onkeydown={(event) => void nudge(event, String(row.id))}
					onclick={() => onSelect(`tag:${row.id}`)}
					><Hash /><span class="sidebar-label">{row.name}</span>{#if countOf(`tag:${row.id}`)}<small
							class="sidebar-count sidebar-label">{countOf(`tag:${row.id}`)}</small
						>{/if}</button
				>{:else}<p class="sidebar-empty">A little room to organize.</p>{/each}
		</section>
	</nav>
	{#if onAccount}<button
			class="sidebar-link sidebar-account account-button"
			title="Settings · ,"
			onclick={onAccount}
			data-cuelume-open><Settings2 /><span class="sidebar-label">Settings</span></button
		>{:else}<p class="sidebar-link sidebar-account sidebar-readonly" title="View only">
			<Eye /><span class="sidebar-label">View only</span>
		</p>{/if}
</aside>
