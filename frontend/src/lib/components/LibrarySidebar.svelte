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
		Layers,
		Highlighter,
		Star
	} from '@lucide/svelte';
	import { highlightTagId } from '#lib/client/highlights.svelte.js';
	import {
		LIST_VIEWS,
		quadViews,
		sidebarPreference,
		type SidebarView
	} from '#lib/client/sidebar.svelte.js';
	import { ContextMenu } from 'bits-ui';
	import { defaultSpaceId, spaceOf } from '#lib/client/workflows.js';
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
		sidebarFolders as folderState,
		type FolderGroup
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
		onReorderSpace,
		onSetDefault
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
		onSetDefault?: (id: string) => void | Promise<void>;
	} = $props();
	// The space showing: the remembered one if it still exists, else the default.
	const defaultId = $derived(defaultSpaceId(spaces));
	const spaceId = $derived(
		spaces.some((s) => s.id === activeSpace.id) ? activeSpace.id : defaultId
	);
	const shelfIndex = $derived(spaces.findIndex((s) => String(s.id) === spaceId));
	// Many spaces scroll the switcher sideways; the current one is kept in view.
	// One pill glides to the current tab. The tab widens as its name appears, so the pill eases
	// from where it was toward the tab's live box each frame, landing exactly on it.
	let pill: { x: number; w: number } | null = null;
	function spaceTabs(current: string, order: string): Attachment<HTMLElement> {
		return (bar) => {
			void current;
			void order;
			// Keep the current tab in view by scrolling the strip alone. scrollIntoView would also
			// scroll the sidebar's overflow-hidden ancestors, shifting every icon when collapsed.
			const tab = bar.querySelector<HTMLElement>('.space-tab.active');
			if (tab && !untrack(() => collapsed)) {
				const left = tab.offsetLeft,
					right = left + tab.offsetWidth;
				if (left < bar.scrollLeft || right > bar.scrollLeft + bar.clientWidth)
					bar.scrollTo({
						left: left < bar.scrollLeft ? left : right - bar.clientWidth,
						behavior: 'smooth'
					});
			}
			const set = (x: number, w: number) => {
				pill = { x, w };
				bar.style.setProperty('--pill-x', `${x}px`);
				bar.style.setProperty('--pill-w', `${w}px`);
			};
			let frame = 0;
			const from = pill,
				start = performance.now(),
				duration = prefersReducedMotion.current ? 0 : 360;
			const step = () => {
				const box = bar.querySelector<HTMLElement>('.space-tab.active');
				if (!box?.offsetWidth) {
					bar.dataset.pill = 'off';
					return;
				}
				bar.dataset.pill = 'on';
				const t = duration ? Math.min(1, (performance.now() - start) / duration) : 1;
				const eased = 1 - (1 - t) ** 3;
				const x = box.offsetLeft,
					w = box.offsetWidth;
				if (!from || t >= 1) set(x, w);
				else set(from.x + (x - from.x) * eased, from.w + (w - from.w) * eased);
				frame = from && t < 1 ? requestAnimationFrame(step) : 0;
			};
			step();
			const observer = new ResizeObserver(() => {
				if (!frame) step();
			});
			observer.observe(bar);
			return () => {
				cancelAnimationFrame(frame);
				observer.disconnect();
			};
		};
	}
	// Only this space's folders and loose tags; a tag inside a folder goes where its folder goes.
	const spaceFolders = $derived(folders.filter((f) => spaceOf(f, folders, spaces) === spaceId));
	const spaceTags = $derived(tags.filter((t) => spaceOf(t, folders, spaces) === spaceId));
	const grouped = $derived(groupTags(spaceTags, spaceFolders));
	// The shelves sit side by side in a native, snapping horizontal scroller, so a two-finger
	// swipe is the platform's own scroll: momentum, interruption and reversal all just work.
	// With two or more spaces, a copy of the last sits before the first and a copy of the first
	// after the last; landing on a copy jumps to the real one, so swiping wraps seamlessly.
	let scroller = $state<HTMLElement>(),
		scrolling = $state(false),
		// The space nearest the middle while scrolling, so the tabs follow the fingers.
		liveIndex = $state(-1);
	const loop = $derived(spaces.length > 1);
	const panelOf = (index: number) => index + (loop ? 1 : 0);
	const indexOf = (panel: number) => (loop ? (panel - 1 + spaces.length) % spaces.length : panel);
	const tabId = $derived(liveIndex >= 0 ? String(spaces[liveIndex]?.id ?? spaceId) : spaceId);
	function scrollToPanel(panel: number) {
		const el = scroller;
		if (!el) return;
		el.scrollTo({
			left: panel * el.clientWidth,
			behavior: prefersReducedMotion.current ? 'instant' : 'smooth'
		});
	}
	function shelfScroll(count: number): Attachment<HTMLElement> {
		return (el) => {
			void count;
			let frame = 0,
				idle = 0;
			// The scroller is as tall as the shelf in view, blending between two while swiping, and
			// never shorter than the room left in the sidebar, so swiping below a short list works.
			const nav = el.closest<HTMLElement>('.sidebar-navigation');
			const fit = () => {
				const w = el.clientWidth;
				if (!w) return;
				const at = el.scrollLeft / w,
					i = Math.floor(at);
				const panels = [...el.children] as HTMLElement[];
				const a = panels[i]?.offsetHeight ?? 0,
					b = panels[i + 1]?.offsetHeight ?? a;
				const room = nav ? nav.clientHeight - el.offsetTop : 0;
				el.style.height = `${Math.max(room, a + (b - a) * (at - i))}px`;
			};
			const settle = () => {
				clearTimeout(idle);
				const w = el.clientWidth;
				if (w) {
					let panel = Math.round(el.scrollLeft / w);
					if (loop && (panel === 0 || panel === spaces.length + 1)) {
						panel = panel === 0 ? spaces.length : 1;
						el.scrollTo({ left: panel * w, behavior: 'instant' });
					}
					const id = String(spaces[indexOf(panel)]?.id ?? '');
					if (id && id !== spaceId) showSpace(id);
				}
				scrolling = false;
				liveIndex = -1;
				fit();
			};
			const scroll = () => {
				const w = el.clientWidth;
				scrolling = true;
				if (w) liveIndex = indexOf(Math.round(el.scrollLeft / w));
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(fit);
				// Where scrollend isn't supported, a pause in scrolling stands in for it.
				clearTimeout(idle);
				idle = window.setTimeout(settle, 150);
			};
			// Only a width change (collapsing, resizing) re-centres the current shelf; height
			// changes come from fit() itself and from shelves growing, and must not touch scroll.
			let lastWidth = 0;
			const resize = () => {
				const w = el.clientWidth;
				if (w && w !== lastWidth) {
					lastWidth = w;
					el.scrollTo({ left: panelOf(untrack(() => shelfIndex)) * w, behavior: 'instant' });
				}
				fit();
			};
			// Start on the current shelf without a visible scroll.
			untrack(resize);
			const observer = new ResizeObserver(resize);
			observer.observe(el);
			if (nav) observer.observe(nav);
			for (const panel of el.children) observer.observe(panel);
			el.addEventListener('scroll', scroll, { passive: true });
			el.addEventListener('scrollend', settle);
			return () => {
				cancelAnimationFrame(frame);
				clearTimeout(idle);
				observer.disconnect();
				el.removeEventListener('scroll', scroll);
				el.removeEventListener('scrollend', settle);
			};
		};
	}
	// When the space changes from elsewhere (a tab, a key, opening a tag), scroll to it.
	$effect(() => {
		const el = scroller,
			panel = panelOf(shelfIndex);
		if (!el || shelfIndex < 0 || untrack(() => scrolling)) return;
		const w = el.clientWidth;
		if (w && Math.round(el.scrollLeft / w) !== panel) scrollToPanel(panel);
	});
	function switchTo(id: string) {
		const to = spaces.findIndex((s) => s.id === id);
		if (to >= 0) scrollToPanel(panelOf(to));
	}
	// From wherever the scroller is now, so quick presses queue up instead of waiting.
	function step(by: 1 | -1) {
		const el = scroller;
		if (!el?.clientWidth || spaces.length < 2) return;
		const panel = Math.round(el.scrollLeft / el.clientWidth) + by;
		scrollToPanel(loop ? panel : Math.max(0, Math.min(spaces.length - 1, panel)));
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
		if (home && home !== untrack(() => spaceId)) showSpace(home);
	});
	// A space's folders and loose tags, for the shelves not currently live.
	function shelfOf(id: string) {
		return groupTags(
			tags.filter((t) => spaceOf(t, folders, spaces) === id),
			folders.filter((f) => spaceOf(f, folders, spaces) === id)
		);
	}
	// Spaces reorder by dragging their tabs along the switcher.
	let spaceDrag = $state<{ id: string; order: string[] } | null>(null);
	const tabs = $derived(
		spaceDrag
			? spaceDrag.order.map((id) => spaces.find((s) => s.id === id)).filter((s): s is Row => !!s)
			: spaces
	);
	function startSpaceDrag(event: DragEvent, id: string) {
		spaceDrag = { id, order: spaces.map((s) => String(s.id)) };
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	}
	function overSpaceTab(event: DragEvent, id: string) {
		if (!spaceDrag) return overSpace(event, id);
		event.preventDefault();
		if (id === spaceDrag.id) return;
		const from = spaceDrag.order.indexOf(spaceDrag.id),
			to = spaceDrag.order.indexOf(id);
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const middle = box.left + box.width / 2;
		if ((from < to && event.clientX < middle) || (from > to && event.clientX > middle)) return;
		const order = spaceDrag.order.filter((x) => x !== spaceDrag!.id);
		order.splice(to, 0, spaceDrag.id);
		spaceDrag = { ...spaceDrag, order };
	}
	async function dropSpaceTab(event: DragEvent, id: string) {
		const current = spaceDrag;
		if (!current) return dropOnSpace(event, id);
		event.preventDefault();
		spaceDrag = null;
		const index = current.order.indexOf(current.id);
		if (current.order.join() !== spaces.map((s) => String(s.id)).join())
			await onReorderSpace?.(current.id, index);
	}
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
		await onPlace(current.kind, current.id, id);
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
						active?.closest('[data-open="false"], [inert]') ||
						(narrow && active?.closest('.sidebar-group'));
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
		aria-label={String(row.name)}
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

{#snippet shelfBody(folderGroups: FolderGroup[], loose: Row[], ownId: string, live: boolean)}
	{#each folderGroups as group (String(group.folder.id))}
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
					aria-label={String(group.folder.name)}
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
	{#if live && drag?.kind === 'tag' && drag.group}<div
			class={['sidebar-unfile', target === '' && 'drop-target']}
			role="presentation"
			ondragenter={overLoose}
			ondragover={overLoose}
		>
			Drop here to take out of the folder
		</div>{/if}
	{#each shownTags('', loose) as row (String(row.id))}<div
			class="sidebar-tag-slot"
			animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
		>
			{@render tagRow(row, '')}
		</div>{:else}{#if !folderGroups.length}{#if ownId}<p class="sidebar-empty">
					Nothing here yet. Drag a tag or folder onto this space's tab{#if onEditSpace}, or <button
							class="sidebar-empty-action"
							onclick={() => onEditSpace(spaces.find((x) => x.id === ownId) ?? null)}
							>choose what it shows</button
						>{/if}.
				</p>{:else}<p class="sidebar-empty">A little room to organize.</p>{/if}{/if}{/each}
{/snippet}

{#snippet shelfCopy(id: string)}
	{@const copy = shelfOf(id)}
	{#each copy.groups as group (String(group.folder.id))}
		{@const open = isOpen(String(group.folder.id))}
		<div class="sidebar-folder">
			<div class="sidebar-folder-head">
				<span class="sidebar-link sidebar-folder-toggle"
					><FolderGlyph {open} /><span class="sidebar-label">{group.folder.name}</span></span
				>
			</div>
			{#if open}{#each group.tags as row (String(row.id))}<span class="sidebar-link shelf-copy-tag"
						><Hash /><span class="sidebar-label">{row.name}</span></span
					>{/each}{/if}
		</div>
	{/each}
	{#each copy.loose as row (String(row.id))}<span class="sidebar-link"
			><Hash /><span class="sidebar-label">{row.name}</span></span
		>{/each}
{/snippet}

<aside class={['library-sidebar', collapsed && 'collapsed']}>
	<div class="sidebar-brand">
		<Brand {home} labelClass="sidebar-label" />
		<button
			class="icon-button sidebar-toggle"
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={!collapsed}
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
						onclick={() => onSelect(item.id)}
						><item.icon />{#if countOf(item.id)}<small class="quad-count sidebar-label"
								>{countOf(item.id)}</small
							>{/if}</button
					>{/each}
			</div>{:else}{#each views as item (item.id)}<button
					class={['sidebar-link', view === item.id && 'active']}
					aria-current={view === item.id ? 'page' : undefined}
					aria-label={item.label}
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
					{@attach spaceTabs(tabId, tabs.map((t) => String(t.id)).join())}
				>
					<span class="space-pill" aria-hidden="true"></span>
					{#each tabs as entry, index (String(entry.id))}
						{@const id = String(entry.id)}
						{@const selected = id === tabId}
						{@const isDefault = id === defaultId}
						{@const sticker = typeof entry.icon === 'string' ? stickers.get(entry.icon) : undefined}

						<div
							class="space-tab-cell"
							animate:flip={{ duration: prefersReducedMotion.current ? 0 : 200 }}
						>
							{#snippet tab()}<button
									class={[
										'space-tab',
										sticker && 'has-icon',
										selected && 'active',
										spaceTarget === id && 'drop-target',
										spaceDrag?.id === id && 'dragging'
									]}
									role="tab"
									aria-selected={selected}
									tabindex={selected ? 0 : -1}
									draggable={!!onReorderSpace && !collapsed}
									ondragstart={(event) => startSpaceDrag(event, id)}
									ondragend={() => (spaceDrag = null)}
									ondragenter={(event) => overSpaceTab(event, id)}
									ondragover={(event) => overSpaceTab(event, id)}
									ondragleave={() => {
										if (spaceTarget === id) spaceTarget = null;
									}}
									ondrop={(event) => void dropSpaceTab(event, id)}
									onclick={() => switchTo(id)}
									>{#if sticker}<Sticker {sticker} />{/if}<span class="space-name"
										>{entry.name}</span
									></button
								>{/snippet}
							{#if onEditSpace}<ContextMenu.Root
									><ContextMenu.Trigger class="space-tab-slot">{@render tab()}</ContextMenu.Trigger
									><ContextMenu.Portal
										><ContextMenu.Content class="menu-content" collisionPadding={12}>
											<ContextMenu.Item class="menu-item" onSelect={() => onEditSpace(entry)}
												><Pencil /><span>Edit space</span></ContextMenu.Item
											>
											{#if onSetDefault && !isDefault}<ContextMenu.Item
													class="menu-item"
													onSelect={() => onSetDefault(id)}
													><Star /><span>Make default</span></ContextMenu.Item
												>{/if}
											{#if onReorderSpace && index > 0}<ContextMenu.Item
													class="menu-item"
													onSelect={() => onReorderSpace(id, index - 1)}
													><ChevronLeft /><span>Move left</span></ContextMenu.Item
												>{/if}
											{#if onReorderSpace && index < spaces.length - 1}<ContextMenu.Item
													class="menu-item"
													onSelect={() => onReorderSpace(id, index + 1)}
													><ChevronRight /><span>Move right</span></ContextMenu.Item
												>{/if}
											<ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
												class="menu-item danger-text"
												disabled={isDefault && spaces.length > 1}
												onSelect={() => onEditSpace(entry, 'delete')}
												><DeleteIcon /><span
													>{isDefault && spaces.length > 1
														? 'Default can’t be deleted'
														: 'Delete'}</span
												></ContextMenu.Item
											>
										</ContextMenu.Content></ContextMenu.Portal
									></ContextMenu.Root
								>{:else}<span class="space-tab-slot">{@render tab()}</span>{/if}
						</div>
					{/each}
					{#if onEditSpace}<button
							class="space-add"
							aria-label="New space"
							onclick={() => onEditSpace(null)}><Plus /></button
						>{/if}
				</div>{/if}
			<div class="sidebar-section-heading">
				<button
					class={['sidebar-heading-link', view === 'tags' && 'active']}
					aria-current={view === 'tags' ? 'page' : undefined}
					onclick={() => onSelect('tags')}>Tags</button
				><span class="sidebar-heading-actions"
					>{#if onEditSpace && !spaces.length}<button
							class="icon-button"
							aria-label="New space"
							onclick={() => onEditSpace(null)}><Layers /></button
						>{/if}{#if onCreate}<button
							class="icon-button"
							aria-label="Add tag or folder"
							onclick={() => onCreate('tag')}><Plus /></button
						>{/if}</span
				>
			</div>
			{#if spaces.length}<div
					class={['shelf-scroller', scrolling && 'moving']}
					bind:this={scroller}
					{@attach shelfScroll(spaces.length)}
				>
					{#if loop}<div class="sidebar-shelf" inert>
							{@render shelfCopy(String(spaces[spaces.length - 1].id))}
						</div>{/if}
					{#each spaces as space (String(space.id))}
						{@const id = String(space.id)}
						<div class="sidebar-shelf" inert={id !== spaceId} data-space-id={id}>
							{#if id === spaceId}{@render shelfBody(
									shownFolders,
									grouped.loose,
									id,
									true
								)}{:else}{@const own = shelfOf(id)}{@render shelfBody(
									own.groups,
									own.loose,
									id,
									false
								)}{/if}
						</div>
					{/each}
					{#if loop}<div class="sidebar-shelf" inert>
							{@render shelfCopy(String(spaces[0].id))}
						</div>{/if}
				</div>{:else}{@render shelfBody(shownFolders, grouped.loose, '', true)}{/if}
		</section>
	</nav>
	{#if onAccount}<div class="sidebar-footer">
			<button
				class="sidebar-link sidebar-account account-button"
				aria-label="Settings"
				aria-keyshortcuts=","
				onclick={onAccount}
				data-cuelume-open><Settings2 /><span class="sidebar-label">Settings</span></button
			>{#if footerTrash}<button
					class={['icon-button sidebar-trash', view === 'trash' && 'active']}
					aria-label="Trash"
					aria-current={view === 'trash' ? 'page' : undefined}
					onclick={() => onSelect('trash')}><Trash2 /></button
				>{/if}
		</div>{:else}<p class="sidebar-link sidebar-account sidebar-readonly">
			<Eye /><span class="sidebar-label">View only</span>
		</p>{/if}
</aside>
