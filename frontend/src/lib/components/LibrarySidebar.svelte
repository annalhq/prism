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
		Eye,
		Pencil,
		Trash2 as DeleteIcon,
		ChevronLeft,
		ChevronRight,
		House,
		Layers,
		Highlighter
	} from '@lucide/svelte';
	import { highlightTagId } from '#lib/client/highlights.svelte.js';
	import {
		LIST_VIEWS,
		quadViews,
		sidebarPreference,
		type SidebarView
	} from '#lib/client/sidebar.svelte.js';
	import { ContextMenu } from 'bits-ui';
	import { fly } from 'svelte/transition';
	import { spaceOf } from '#lib/client/workflows.js';
	import { activeSpace, restoreSpace, showSpace } from '#lib/client/spaces.svelte.js';
	import { ensureStickers, stickers } from '#lib/client/stickers.svelte.js';
	import Sticker from './ui/Sticker.svelte';
	import type { Attachment } from 'svelte/attachments';
	import { onMount, tick, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import Brand from './ui/Brand.svelte';
	import FolderGlyph from './ui/FolderGlyph.svelte';
	import FolderMenu from './FolderMenu.svelte';
	import {
		folderOf,
		groupTags,
		sidebarFolders as folderState
	} from '#lib/client/folders.svelte.js';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		folders = [],
		spaces = [],
		collapsed = $bindable(false),
		home,
		counts,
		onSelect,
		onCreate,
		onAccount,
		onReorder,
		onReorderFolder,
		onFile,
		onEditFolder,
		onCreateIn,
		onEditSpace,
		onPlace,
		onReorderSpace
	}: {
		view: string;
		tags: Row[];
		// Folders only group tags; a tag in no folder is listed loose, after them.
		folders?: Row[];
		// Shelves of tags, one showing at a time; none means one plain list.
		spaces?: Row[];
		collapsed?: boolean;
		home?: '/' | '/public';
		// Item counts beside each view and tag; absent until the library has loaded.
		counts?: {
			counts: Record<string, number>;
			// Bookmarks inside each folder, each counted once.
			folders?: Record<string, number>;
			shelves: { all: number; later: number; people: number; trash: number };
		};
		onSelect: (value: string) => void;
		// Without these the sidebar is view-only: no adding, no trash, no account.
		onCreate?: (type: string) => void;
		onAccount?: () => void;
		// Moves a tag to an index of the whole tag list without it; absent where tags are read-only.
		onReorder?: (id: string, toIndex: number) => void | Promise<void>;
		onReorderFolder?: (id: string, toIndex: number) => void | Promise<void>;
		// Files a tag into a folder, or out of every folder with null.
		onFile?: (tagId: string, folderId: string | null) => void | Promise<void>;
		// Folder actions, from a folder's context menu: the sheet (rename, choose tags, delete)
		// and a new tag started inside it.
		onEditFolder?: (folder: Row, intent?: 'delete') => void;
		onCreateIn?: (folder: Row) => void;
		// Space sheet (null creates one), dropping onto a space, and reordering spaces.
		onEditSpace?: (space: Row | null, intent?: 'delete') => void;
		onPlace?: (kind: 'tag' | 'folder', id: string, spaceId: string | null) => void | Promise<void>;
		onReorderSpace?: (id: string, toIndex: number) => void | Promise<void>;
	} = $props();
	// The space showing: Home ('') unless the remembered one still exists.
	const spaceId = $derived(spaces.some((s) => s.id === activeSpace.id) ? activeSpace.id : '');
	const shelf = $derived([{ id: '', name: 'Home' } as Row, ...spaces]);
	const shelfIndex = $derived(shelf.findIndex((s) => String(s.id) === spaceId));
	// Many spaces scroll the switcher sideways; the current one is kept in view.
	function followActive(current: string): Attachment<HTMLElement> {
		return (bar) => {
			void current;
			bar
				.querySelector('.space-tab.active')
				?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
		};
	}
	// Only this space's folders and loose tags; a tag inside a folder goes where its folder goes.
	const spaceFolders = $derived(folders.filter((f) => spaceOf(f, folders, spaces) === spaceId));
	const spaceTags = $derived(tags.filter((t) => spaceOf(t, folders, spaces) === spaceId));
	const grouped = $derived(groupTags(spaceTags, spaceFolders));
	// 1 slides the next shelf in from the right, -1 from the left.
	let direction = $state(1);
	function switchTo(id: string) {
		if (id === spaceId) return;
		const to = shelf.findIndex((s) => String(s.id) === id);
		direction = to >= shelfIndex ? 1 : -1;
		showSpace(id);
	}
	function step(by: number) {
		const next = shelf[shelfIndex + by];
		if (next) switchTo(String(next.id));
	}
	onMount(restoreSpace);
	const spaceIcons = $derived(
		spaces.map((s) => s.icon).filter((icon): icon is string => typeof icon === 'string')
	);
	$effect(() => {
		if (spaceIcons.length) void ensureStickers(spaceIcons);
	});
	// Opening a tag kept in another space brings that space forward, so the row is in view.
	$effect(() => {
		if (!view.startsWith('tag:')) return;
		const tag = untrack(() => tags.find((t) => t.id === view.slice(4)));
		if (!tag) return;
		const home = untrack(() => spaceOf(tag, folders, spaces));
		if (home !== untrack(() => spaceId)) untrack(() => switchTo(home));
	});
	// A sideways two-finger swipe switches spaces; one gesture, momentum included, is one step.
	const swipe: Attachment<HTMLElement> = (node) => {
		let travelled = 0,
			spent = false,
			idle = 0;
		const settle = () => {
			travelled = 0;
			spent = false;
			node.style.setProperty('--swipe', '0px');
		};
		const wheel = (event: WheelEvent) => {
			if (collapsed || spaces.length === 0 || Math.abs(event.deltaX) <= Math.abs(event.deltaY))
				return;
			event.preventDefault();
			clearTimeout(idle);
			idle = window.setTimeout(settle, 160);
			if (spent) return;
			travelled += event.deltaX;
			const edge = !shelf[shelfIndex + Math.sign(travelled)];
			const lean = Math.max(-32, Math.min(32, -travelled * (edge ? 0.12 : 0.3)));
			node.style.setProperty('--swipe', `${lean}px`);
			if (!edge && Math.abs(travelled) > 90) {
				spent = true;
				node.style.setProperty('--swipe', '0px');
				step(Math.sign(travelled));
			}
		};
		node.addEventListener('wheel', wheel, { passive: false });
		return () => {
			clearTimeout(idle);
			node.removeEventListener('wheel', wheel);
		};
	};
	// A tag or folder dragged onto a space in the switcher goes to that space.
	let spaceTarget = $state<string | null>(null);
	function overSpace(event: DragEvent, id: string) {
		if (!onPlace || !accept(event)) return;
		spaceTarget = id === spaceId ? null : id;
	}
	async function dropOnSpace(event: DragEvent, id: string) {
		const current = drag;
		event.preventDefault();
		drag = null;
		target = null;
		preview = null;
		spaceTarget = null;
		if (!current || !onPlace || id === spaceId) return;
		await onPlace(current.kind, current.id, id || null);
	}
	function spaceKeys(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		step(event.key === 'ArrowLeft' ? -1 : 1);
		void tick().then(() =>
			document
				.querySelector<HTMLElement>('.library-sidebar .space-tab[aria-selected="true"]')
				?.focus()
		);
	}
	// While dragging, `preview` is the dragged row's list (its group's tags, or the folders) as it
	// would be if dropped now, so neighbours slide aside under the pointer instead of jumping on
	// drop. A tag dragged over another group targets it instead: `target` is that folder, or ''
	// for loose.
	let drag = $state<{ kind: 'tag' | 'folder'; id: string; group: string } | null>(null),
		preview = $state<string[] | null>(null),
		target = $state<string | null>(null),
		committing = false;
	function ordered<T>(rows: T[], order: string[] | null, key: (row: T) => string): T[] {
		if (!order) return rows;
		const byId = new Map(rows.map((r) => [key(r), r]));
		const shown = order.map((id) => byId.get(id)).filter((r): r is T => !!r);
		// A row added mid-drag still shows, at the end.
		return [...shown, ...rows.filter((r) => !order.includes(key(r)))];
	}
	const shownFolders = $derived(
		drag?.kind === 'folder'
			? ordered(grouped.groups, preview, (g) => String(g.folder.id))
			: grouped.groups
	);
	const shownTags = (group: string, rows: Row[]) =>
		drag?.kind === 'tag' && drag.group === group
			? ordered(rows, preview, (r) => String(r.id))
			: rows;
	const groupRows = (group: string) =>
		group ? (grouped.groups.find((g) => g.folder.id === group)?.tags ?? []) : grouped.loose;
	const ids = (rows: Row[]) => rows.map((r) => String(r.id));
	const isOpen = (id: string) => folderState.isOpen(id);
	onMount(() => folderState.restore());
	// Opening a tag inside a folded folder unfolds it, so the current row is never hidden.
	$effect(() => {
		if (!view.startsWith('tag:')) return;
		const tag = untrack(() => tags.find((t) => t.id === view.slice(4)));
		const folder = tag
			? folderOf(
					tag,
					untrack(() => folders)
				)
			: '';
		if (folder && untrack(() => !folderState.isOpen(folder))) folderState.setOpen(folder, true);
	});
	function start(event: DragEvent, kind: 'tag' | 'folder', row: Row, group = '') {
		drag = { kind, id: String(row.id), group };
		preview = kind === 'tag' ? ids(groupRows(group)) : ids(grouped.groups.map((g) => g.folder));
		spaceTarget = null;
		target = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(row.name));
		}
	}
	// Swap only once the pointer passes the middle of the row in the direction of travel,
	// so a row sliding under a still pointer does not bounce straight back.
	function swap(event: DragEvent, id: string) {
		if (!drag || !preview || id === drag.id) return;
		const from = preview.indexOf(drag.id),
			to = preview.indexOf(id);
		if (from === -1 || to === -1) return;
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const middle = box.top + box.height / 2;
		if ((from < to && event.clientY < middle) || (from > to && event.clientY > middle)) return;
		const next = preview.filter((x) => x !== drag!.id);
		next.splice(to, 0, drag.id);
		preview = next;
	}
	function accept(event: DragEvent) {
		if (!drag) return false;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		return true;
	}
	function overTag(event: DragEvent, id: string, group: string) {
		if (!accept(event) || drag!.kind !== 'tag') return;
		if (group !== drag!.group && onFile) {
			target = group;
			return;
		}
		target = null;
		swap(event, id);
	}
	function overFolder(event: DragEvent, id: string) {
		if (!accept(event)) return;
		if (drag!.kind === 'folder') swap(event, id);
		else if (onFile) target = id === drag!.group ? null : id;
	}
	function overLoose(event: DragEvent) {
		if (accept(event) && drag!.kind === 'tag' && drag!.group && onFile) target = '';
	}
	/** Where `id` lands in the full tag list (without it) for its place in `order`. */
	function tagIndex(id: string, order: string[]): number | null {
		const at = order.indexOf(id);
		const rest = ids(tags).filter((x) => x !== id);
		if (order[at - 1]) return rest.indexOf(order[at - 1]) + 1;
		if (order[at + 1]) return rest.indexOf(order[at + 1]);
		return null;
	}
	/** Where folder `id` lands among every folder (without it) for its place in `order`. */
	function folderIndex(id: string, order: string[]): number | null {
		const at = order.indexOf(id);
		const rest = ids(folders).filter((x) => x !== id);
		if (order[at - 1]) return rest.indexOf(order[at - 1]) + 1;
		if (order[at + 1]) return rest.indexOf(order[at + 1]);
		return null;
	}
	async function finishDrag() {
		const current = drag,
			order = preview,
			into = target;
		drag = null;
		target = null;
		if (!current || !order) {
			preview = null;
			return;
		}
		committing = true;
		try {
			if (current.kind === 'tag' && into !== null) await onFile?.(current.id, into || null);
			else if (current.kind === 'folder') {
				const index = folderIndex(current.id, order);
				if (order.join() !== ids(spaceFolders).join() && index !== null)
					await onReorderFolder?.(current.id, index);
			} else if (order.join() !== ids(groupRows(current.group)).join()) {
				// Keep the previewed order until the saved one arrives, so nothing snaps back.
				const index = tagIndex(current.id, order);
				if (index !== null) await onReorder?.(current.id, index);
			}
		} finally {
			committing = false;
			preview = null;
		}
	}
	function cancelDrag() {
		drag = null;
		target = null;
		spaceTarget = null;
		if (!committing) preview = null;
	}
	const arrow = (event: KeyboardEvent) =>
		event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)
			? event.key === 'ArrowUp'
				? -1
				: 1
			: 0;
	async function nudge(event: KeyboardEvent, id: string, group: string) {
		const step = arrow(event);
		if (!onReorder || !step) return;
		event.preventDefault();
		const order = ids(groupRows(group));
		const index = order.indexOf(id);
		if (index === -1 || !order[index + step]) return;
		order.splice(index, 1);
		order.splice(index + step, 0, id);
		const to = tagIndex(id, order);
		if (to !== null) await onReorder(id, to);
		await tick();
		document.querySelector<HTMLElement>(`.library-sidebar [data-tag-id="${id}"]`)?.focus();
	}
	async function nudgeFolder(event: KeyboardEvent, id: string) {
		const step = arrow(event);
		if (!onReorderFolder || !step) return;
		event.preventDefault();
		const order = ids(spaceFolders);
		const index = order.indexOf(id);
		if (index === -1 || !order[index + step]) return;
		order.splice(index, 1);
		order.splice(index + step, 0, id);
		const to = folderIndex(id, order);
		if (to !== null) await onReorderFolder(id, to);
		await tick();
		document.querySelector<HTMLElement>(`.library-sidebar [data-folder-id="${id}"]`)?.focus();
	}
	// Highlights opens the #highlight tag, when there is one.
	const highlightTag = $derived(highlightTagId(tags));
	const VIEW_META: Record<SidebarView, { label: string; icon: typeof Bookmark }> = {
		all: { label: 'All bookmarks', icon: Bookmark },
		later: { label: 'Read later', icon: Clock3 },
		people: { label: 'People', icon: Users },
		trash: { label: 'Trash', icon: Trash2 },
		highlights: { label: 'Highlights', icon: Highlighter }
	};
	const viewTarget = (id: SidebarView) =>
		id === 'highlights' ? (highlightTag ? `tag:${highlightTag}` : null) : id;
	const entry = (id: SidebarView) => ({ id: viewTarget(id), ...VIEW_META[id] });
	// Quad is the owner's layout; read-only sidebars (the public page) keep the plain list.
	const quad = $derived(!!onCreate && sidebarPreference.mode === 'quad');
	const views = $derived(
		(quad ? quadViews() : LIST_VIEWS)
			.map(entry)
			.filter((item): item is typeof item & { id: string } => item.id !== null)
	);
	// Trash sits in the footer unless it is one of the quad tiles.
	const footerTrash = $derived(!!onCreate && !(quad && sidebarPreference.quad.includes('trash')));
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
			let frame = 0;
			// Measured from the rendered boxes, after layout, so nested groups and webfont
			// swaps can't throw it off.
			const place = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					// Only rows carry the highlight. The Tags heading marks its page by colour alone,
					// so on the tags page the highlight fades out instead of covering the heading.
					const active = nav.querySelector<HTMLElement>('.sidebar-link[aria-current="page"]');
					const box = active?.getBoundingClientRect();
					// Hidden rows (a folded folder, or tags in the collapsed sidebar) carry no highlight.
					const hidden =
						active?.closest('[data-open="false"]') || (narrow && active?.closest('.sidebar-group'));
					if (!active || !box?.height || hidden) {
						nav.dataset.indicator = 'off';
						return;
					}
					const top = box.top - nav.getBoundingClientRect().top + nav.scrollTop;
					nav.style.setProperty('--indicator-y', `${top}px`);
					nav.style.setProperty('--indicator-h', `${box.height}px`);
					nav.dataset.indicator = 'on';
				});
			};
			// Collapsed, only the views show; start from the top so none are scrolled away.
			if (narrow) nav.scrollTop = 0;
			place();
			const observer = new ResizeObserver(place);
			observer.observe(nav);
			void document.fonts?.ready.then(place);
			// A folder folding or unfolding moves the rows below it; follow them while it runs.
			let following = false;
			const follow = () => {
				if (!following) return;
				place();
				requestAnimationFrame(follow);
			};
			const begin = (event: TransitionEvent) => {
				if (!(event.target as HTMLElement).matches('.sidebar-folder-tags') || following) return;
				following = true;
				follow();
			};
			const end = (event: TransitionEvent) => {
				if (!(event.target as HTMLElement).matches('.sidebar-folder-tags')) return;
				following = false;
				place();
			};
			nav.addEventListener('transitionrun', begin);
			nav.addEventListener('transitionend', end);
			nav.addEventListener('transitioncancel', end);
			return () => {
				following = false;
				cancelAnimationFrame(frame);
				observer.disconnect();
				nav.removeEventListener('transitionrun', begin);
				nav.removeEventListener('transitionend', end);
				nav.removeEventListener('transitioncancel', end);
			};
		};
	}
	// The quad's current-tile tab, gliding between tiles. Appears in place, then slides.
	function quadIndicator(current: string, order: string): Attachment<HTMLElement> {
		return (grid) => {
			void current;
			void order;
			let frame = 0;
			const place = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					const tile = grid.querySelector<HTMLElement>('.quad-tile[aria-current="page"]');
					if (!tile?.offsetWidth) {
						grid.dataset.indicator = 'off';
						return;
					}
					if (grid.dataset.indicator !== 'on') {
						grid.dataset.indicator = 'arriving';
						requestAnimationFrame(() => (grid.dataset.indicator = 'on'));
					}
					grid.style.setProperty('--quad-x', `${tile.offsetLeft}px`);
					grid.style.setProperty('--quad-y', `${tile.offsetTop}px`);
					grid.style.setProperty('--quad-w', `${tile.offsetWidth}px`);
					grid.style.setProperty('--quad-h', `${tile.offsetHeight}px`);
				});
			};
			place();
			const observer = new ResizeObserver(place);
			observer.observe(grid);
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

{#snippet tagRow(row: Row, group: string)}<button
		class={[
			'sidebar-link',
			view === `tag:${row.id}` && 'active',
			drag?.kind === 'tag' && drag.id === row.id && 'dragging'
		]}
		aria-current={view === `tag:${row.id}` ? 'page' : undefined}
		aria-keyshortcuts={onReorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
		title={onReorder ? `${row.name} · drag or Alt+↑/↓ to reorder` : String(row.name)}
		data-tag-id={String(row.id)}
		draggable={!!onReorder && !collapsed}
		ondragstart={(event) => start(event, 'tag', row, group)}
		ondragenter={(event) => overTag(event, String(row.id), group)}
		ondragover={(event) => overTag(event, String(row.id), group)}
		ondragend={cancelDrag}
		onkeydown={(event) => void nudge(event, String(row.id), group)}
		onclick={() => onSelect(`tag:${row.id}`)}
		><Hash /><span class="sidebar-label">{row.name}</span>{#if countOf(`tag:${row.id}`)}<small
				class="sidebar-count sidebar-label">{countOf(`tag:${row.id}`)}</small
			>{/if}</button
	>{/snippet}

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
		{@attach swipe}
		{@attach highlight(
			view,
			[
				spaceId,
				quad ? quadViews().join() : 'list',
				...shownFolders.map((g) => `${g.folder.id}:${ids(g.tags)}`),
				ids(grouped.loose),
				[...folderState.closed]
			].join('|'),
			collapsed
		)}
	>
		<span class="sidebar-indicator" aria-hidden="true"></span>
		{#if quad}<div
				class="quad-grid"
				role="group"
				aria-label="Views"
				{@attach quadIndicator(view, views.map((v) => v.id).join())}
			>
				<span class="quad-indicator" aria-hidden="true"></span>
				{#each views as item (item.id)}<button
						class={['quad-tile', view === item.id && 'active']}
						aria-current={view === item.id ? 'page' : undefined}
						aria-label={item.label}
						title={countOf(item.id) ? `${item.label} · ${countOf(item.id)}` : item.label}
						onclick={() => onSelect(item.id)}
						><item.icon />{#if countOf(item.id)}<small class="quad-count sidebar-label"
								>{countOf(item.id)}</small
							>{/if}</button
					>{/each}
			</div>{:else}{#each views as item (item.id)}<button
					class={['sidebar-link', view === item.id && 'active']}
					aria-current={view === item.id ? 'page' : undefined}
					title={item.label}
					onclick={() => onSelect(item.id)}
					><item.icon /><span class="sidebar-label">{item.label}</span>{#if countOf(item.id)}<small
							class="sidebar-count sidebar-label">{countOf(item.id)}</small
						>{/if}</button
				>{/each}{/if}
		<hr class="sidebar-divider" />
		<!-- Drops anywhere in the group, including gaps between rows, commit the preview. -->
		<section
			class="sidebar-group"
			role="group"
			aria-label="Tags"
			ondragover={(event) => {
				if (drag) event.preventDefault();
			}}
			ondrop={(event) => {
				if (!drag) return;
				event.preventDefault();
				void finishDrag();
			}}
		>
			{#if spaces.length}<div
					class="space-bar sidebar-label"
					role="tablist"
					aria-label="Spaces · swipe sideways over the list to switch"
					tabindex="-1"
					onkeydown={spaceKeys}
					{@attach followActive(spaceId)}
				>
					{#each shelf as entry, index (String(entry.id))}
						{@const id = String(entry.id)}
						{@const selected = id === spaceId}
						{@const sticker = typeof entry.icon === 'string' ? stickers.get(entry.icon) : undefined}
						{#snippet tab()}<button
								class={[
									'space-tab',
									(sticker || !id) && 'has-icon',
									selected && 'active',
									spaceTarget === id && 'drop-target'
								]}
								role="tab"
								aria-selected={selected}
								tabindex={selected ? 0 : -1}
								title={selected
									? String(entry.name)
									: `${entry.name} · drop a tag or folder to move it here`}
								ondragenter={(event) => overSpace(event, id)}
								ondragover={(event) => overSpace(event, id)}
								ondragleave={() => {
									if (spaceTarget === id) spaceTarget = null;
								}}
								ondrop={(event) => void dropOnSpace(event, id)}
								onclick={() => switchTo(id)}
								>{#if sticker}<Sticker {sticker} />{:else if !id}<House
										class="space-home"
									/>{/if}<span class="space-name">{entry.name}</span></button
							>{/snippet}
						{#if id && onEditSpace}<ContextMenu.Root
								><ContextMenu.Trigger class="space-tab-slot">{@render tab()}</ContextMenu.Trigger
								><ContextMenu.Portal
									><ContextMenu.Content class="menu-content" collisionPadding={12}>
										<ContextMenu.Item class="menu-item" onSelect={() => onEditSpace(entry)}
											><Pencil /><span>Edit space</span></ContextMenu.Item
										>
										{#if onReorderSpace && index > 1}<ContextMenu.Item
												class="menu-item"
												onSelect={() => onReorderSpace(id, index - 2)}
												><ChevronLeft /><span>Move left</span></ContextMenu.Item
											>{/if}
										{#if onReorderSpace && index < spaces.length}<ContextMenu.Item
												class="menu-item"
												onSelect={() => onReorderSpace(id, index)}
												><ChevronRight /><span>Move right</span></ContextMenu.Item
											>{/if}
										<ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
											class="menu-item danger-text"
											onSelect={() => onEditSpace(entry, 'delete')}
											><DeleteIcon /><span>Delete</span></ContextMenu.Item
										>
									</ContextMenu.Content></ContextMenu.Portal
								></ContextMenu.Root
							>{:else}<span class="space-tab-slot">{@render tab()}</span>{/if}
					{/each}
					{#if onEditSpace}<button
							class="space-add"
							aria-label="New space"
							title="New space"
							onclick={() => onEditSpace(null)}><Plus /></button
						>{/if}
				</div>{/if}
			<div class="sidebar-section-heading">
				<button
					class={['sidebar-heading-link', view === 'tags' && 'active']}
					aria-current={view === 'tags' ? 'page' : undefined}
					title="Explore all tags"
					onclick={() => onSelect('tags')}>Tags</button
				><span class="sidebar-heading-actions"
					>{#if onEditSpace && !spaces.length}<button
							class="icon-button"
							aria-label="New space"
							title="New space · split your tags into shelves you swipe between"
							onclick={() => onEditSpace(null)}><Layers /></button
						>{/if}{#if onCreate}<button
							class="icon-button"
							aria-label="Add tag or folder"
							title="Add tag · end with / for a folder"
							onclick={() => onCreate('tag')}><Plus /></button
						>{/if}</span
				>
			</div>
			{#key spaceId}<div
					class="sidebar-shelf"
					in:fly={{
						x: 18 * direction,
						duration: prefersReducedMotion.current ? 0 : 260,
						opacity: 0
					}}
				>
					{#each shownFolders as group (String(group.folder.id))}
						{@const id = String(group.folder.id)}
						{@const open = isOpen(id)}
						<div
							class={['sidebar-folder', drag?.kind === 'folder' && drag.id === id && 'dragging']}
							animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
						>
							{#snippet head()}<button
									class="sidebar-link sidebar-folder-toggle"
									aria-expanded={open}
									aria-keyshortcuts={onReorderFolder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
									title={onReorderFolder
										? `${group.folder.name} · drag or Alt+↑/↓ to reorder`
										: String(group.folder.name)}
									data-folder-id={id}
									draggable={!!onReorderFolder && !collapsed}
									ondragstart={(event) => start(event, 'folder', group.folder)}
									ondragend={cancelDrag}
									onkeydown={(event) => void nudgeFolder(event, id)}
									onclick={() => folderState.setOpen(id, !open)}
									><FolderGlyph open={open || target === id} /><span class="sidebar-label"
										>{group.folder.name}</span
									>{#if counts?.folders?.[id]}<small class="sidebar-count sidebar-label"
											>{counts.folders[id]}</small
										>{/if}</button
								>{/snippet}
							{#if onEditFolder}<FolderMenu
									folder={group.folder}
									onEdit={onEditFolder}
									{onCreateIn}
									class={['sidebar-folder-head', target === id && 'drop-target']}
									ondragenter={(event) => overFolder(event, id)}
									ondragover={(event) => overFolder(event, id)}>{@render head()}</FolderMenu
								>{:else}<div
									class="sidebar-folder-head"
									role="presentation"
									ondragenter={(event) => overFolder(event, id)}
									ondragover={(event) => overFolder(event, id)}
								>
									{@render head()}
								</div>{/if}
							<div class="sidebar-folder-tags" data-open={open} inert={!open}>
								<div>
									{#each shownTags(id, group.tags) as row (String(row.id))}<div
											class="sidebar-tag-slot"
											animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
										>
											{@render tagRow(row, id)}
										</div>{:else}<p class="sidebar-folder-empty">
											{onFile ? 'Drag tags here' : 'Empty'}
										</p>{/each}
								</div>
							</div>
						</div>
					{/each}
					{#if drag?.kind === 'tag' && drag.group}<div
							class={['sidebar-unfile', target === '' && 'drop-target']}
							role="presentation"
							ondragenter={overLoose}
							ondragover={overLoose}
						>
							Drop here to take out of the folder
						</div>{/if}
					{#each shownTags('', grouped.loose) as row (String(row.id))}<div
							class="sidebar-tag-slot"
							animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
						>
							{@render tagRow(row, '')}
						</div>{:else}{#if !grouped.groups.length}{#if spaceId}<p class="sidebar-empty">
									Nothing here yet. Drag a tag or folder onto this space's chip{#if onEditSpace}, or <button
											class="sidebar-empty-action"
											onclick={() => onEditSpace(spaces.find((x) => x.id === spaceId) ?? null)}
											>choose what it shows</button
										>{/if}.
								</p>{:else}<p class="sidebar-empty">A little room to organize.</p>{/if}{/if}{/each}
				</div>{/key}
		</section>
	</nav>
	{#if onAccount}<div class="sidebar-footer">
			<button
				class="sidebar-link sidebar-account account-button"
				title="Settings · ,"
				onclick={onAccount}
				data-cuelume-open><Settings2 /><span class="sidebar-label">Settings</span></button
			>{#if footerTrash}<button
					class={['icon-button sidebar-trash', view === 'trash' && 'active']}
					aria-label="Trash"
					aria-current={view === 'trash' ? 'page' : undefined}
					title={countOf('trash') ? `Trash · ${countOf('trash')}` : 'Trash'}
					onclick={() => onSelect('trash')}><Trash2 /></button
				>{/if}
		</div>{:else}<p class="sidebar-link sidebar-account sidebar-readonly" title="View only">
			<Eye /><span class="sidebar-label">View only</span>
		</p>{/if}
</aside>
