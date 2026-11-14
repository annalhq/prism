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
	import { onMount, tick, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import Brand from './ui/Brand.svelte';
	import FolderGlyph from './ui/FolderGlyph.svelte';
	import FolderMenu from './FolderMenu.svelte';
	import {
		closedFolders,
		folderOf,
		groupTags,
		restoreFolders,
		setFolderOpen
	} from '#lib/client/folders.svelte.js';
	type Row = Record<string, unknown>;
	let {
		view,
		tags,
		folders = [],
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
		onCreateIn
	}: {
		view: string;
		tags: Row[];
		// Folders only group tags; a tag in no folder is listed loose, after them.
		folders?: Row[];
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
	} = $props();
	const grouped = $derived(groupTags(tags, folders));
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
	const isOpen = (id: string) => !closedFolders.has(id);
	onMount(restoreFolders);
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
		if (folder && untrack(() => closedFolders.has(folder))) setFolderOpen(folder, true);
	});
	function start(event: DragEvent, kind: 'tag' | 'folder', row: Row, group = '') {
		drag = { kind, id: String(row.id), group };
		preview = kind === 'tag' ? ids(groupRows(group)) : ids(grouped.groups.map((g) => g.folder));
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
				const index = order.indexOf(current.id);
				if (index !== folders.findIndex((f) => f.id === current.id))
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
		const index = folders.findIndex((f) => f.id === id);
		const next = index + step;
		if (index === -1 || next < 0 || next >= folders.length) return;
		await onReorderFolder(id, next);
		await tick();
		document.querySelector<HTMLElement>(`.library-sidebar [data-folder-id="${id}"]`)?.focus();
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
					// Only rows carry the highlight. The Tags heading marks its page by colour alone,
					// so on the tags page the highlight fades out instead of covering the heading.
					const active = nav.querySelector<HTMLElement>('.sidebar-link[aria-current="page"]');
					const box = active?.getBoundingClientRect();
					if (!active || !box?.height || active.closest('[data-open="false"]')) {
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
		{@attach highlight(
			view,
			[
				...shownFolders.map((g) => `${g.folder.id}:${ids(g.tags)}`),
				ids(grouped.loose),
				[...closedFolders]
			].join('|'),
			collapsed
		)}
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
				if (drag) event.preventDefault();
			}}
			ondrop={(event) => {
				if (!drag) return;
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
				><span class="sidebar-heading-actions"
					>{#if onCreate}<button
							class="icon-button"
							aria-label="Add tag or folder"
							title="Add tag · end with / for a folder"
							onclick={() => onCreate('tag')}><Plus /></button
						>{/if}</span
				>
			</div>
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
							onclick={() => setFolderOpen(id, !open)}
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
				</div>{:else}{#if !folders.length}<p class="sidebar-empty">
						A little room to organize.
					</p>{/if}{/each}
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
