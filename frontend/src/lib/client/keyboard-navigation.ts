import { createModal, keyOf, type Handler, type Mode } from './vim.js';

/**
 * The library's Vim keys: a normal and a visual keymap run by the modal engine in `vim.ts`.
 *
 * Normal mode moves a cursor (the focused row) and acts on it. `v` enters visual mode with an
 * anchor on that row; motions then mark the run between anchor and cursor, `o` swaps the two
 * ends, an operator (`x`, `d`, `y`) acts on the run and returns to normal, and `<Esc>` or `v`
 * returns without acting. Counts work as in Vim: `3j`, `5G`, `2dd`.
 *
 * Text entry, IME composition and overlays are never intercepted; reaching one returns the
 * machine to normal mode.
 */
export function libraryKeyboard(actions: {
	insert: () => void;
	filter: () => void;
	account: () => void;
	help: () => void;
	// Editing actions; a read-only library (the public page) leaves them out and has no visual mode.
	mark?: (ids: string[]) => void;
	cut?: (ids: string[]) => void;
	remove?: (ids: string[]) => void | Promise<void>;
	copy?: (ids: string[]) => void;
}) {
	let anchor: string | null = null;

	const rows = () => [...document.querySelectorAll<HTMLElement>('.bookmark-title, .person-card')];
	const idOf = (element: Element | null | undefined) =>
		element?.closest<HTMLElement>('[data-bookmark-id]')?.dataset.bookmarkId ?? null;
	const active = () => document.activeElement as HTMLElement | null;
	const cursor = (items = rows()) => items.indexOf(active() as HTMLElement);
	const rowOf = () => active()?.closest('.bookmark-gesture') ?? null;
	const focus = (items: HTMLElement[], index: number) => {
		const item = items[Math.max(0, Math.min(items.length - 1, index))];
		item?.focus({ preventScroll: true });
		item?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
	};
	// The run between anchor and cursor, in list order.
	const range = () => {
		const items = rows();
		const from = items.findIndex((item) => idOf(item) === anchor);
		if (from < 0) return [];
		const to = cursor(items);
		const [start, end] = to < 0 ? [from, from] : [Math.min(from, to), Math.max(from, to)];
		return items
			.slice(start, end + 1)
			.map(idOf)
			.filter((id): id is string => !!id);
	};

	// --- Motions: the same in both modes; in visual mode the marked run follows the cursor.
	const motion =
		(to: (current: number, items: HTMLElement[], count: number | null) => number): Handler =>
		(count) => {
			const items = rows();
			focus(items, to(cursor(items), items, count));
			if (machine.mode() === 'visual') actions.mark?.(range());
		};
	const halfPage = (count: number | null) =>
		(count ?? 1) *
		Math.max(
			1,
			Math.floor(
				(document.querySelector('.library-content')?.clientHeight || innerHeight) /
					2 /
					(rowOf()?.getBoundingClientRect().height || 52)
			)
		);
	const down = motion((current, _, count) => current + (count ?? 1));
	const up = motion((current, items, count) =>
		current < 0 ? items.length - 1 : current - (count ?? 1)
	);
	const motions: Record<string, Handler> = {
		j: down,
		'<Down>': down,
		k: up,
		'<Up>': up,
		// `gg` and `G` take a count as a line number, as in Vim.
		gg: motion((_, __, count) => (count ?? 1) - 1),
		G: motion((_, items, count) => (count ? count - 1 : items.length - 1)),
		'<C-d>': motion((current, _, count) => Math.max(0, current) + halfPage(count)),
		'<C-u>': motion((current, _, count) => Math.max(0, current) - halfPage(count))
	};

	// --- Operators on a set of bookmarks.
	// Trashed rows leave the list; the cursor lands on whatever took the first one's place.
	const trash = async (ids: string[], index: number) => {
		await actions.remove?.(ids);
		requestAnimationFrame(() => focus(rows(), index));
	};
	// Visual operators act on the run and end the mode (which clears the marks) first, so the
	// action can mark what it is working on itself.
	const onRun =
		(act: (ids: string[], first: number) => void): Handler =>
		() => {
			const ids = range();
			const first = rows().findIndex((item) => ids.includes(idOf(item) ?? ''));
			machine.set('normal');
			if (ids.length) act(ids, first);
		};
	const clickInRow = (selector: string) => {
		const button = rowOf()?.querySelector<HTMLButtonElement>(selector);
		if (!button) return false;
		button.click();
	};

	const normal: Record<string, Handler> = {
		...motions,
		v: () => {
			const id = idOf(active());
			if (!id || !actions.mark) return false;
			anchor = id;
			return 'visual';
		},
		x: () => {
			const id = idOf(active());
			if (!id || !actions.cut) return false;
			actions.cut([id]);
		},
		dd: (count) => {
			if (!actions.remove) return false;
			const items = rows();
			const start = Math.max(0, cursor(items));
			const ids = items
				.slice(start, start + (count ?? 1))
				.map(idOf)
				.filter((id): id is string => !!id);
			if (ids.length) void trash(ids, start);
		},
		y: () => clickInRow('.bookmark-copy'),
		e: () => clickInRow('.bookmark-edit'),
		// Space edits only from a title; elsewhere it keeps scrolling the page.
		'<Space>': () => (active()?.matches('.bookmark-title') ? clickInRow('.bookmark-edit') : false),
		o: () => {
			const open = rowOf()?.querySelector<HTMLButtonElement>('.bookmark-open');
			if (open) open.click();
			else active()?.click();
		},
		i: () => actions.insert(),
		f: () => actions.filter(),
		',': () => actions.account(),
		'?': () => actions.help()
	};
	normal.V = normal.v;

	const visual: Record<string, Handler> = {
		...motions,
		v: () => 'normal',
		V: () => 'normal',
		// Swap the ends: the cursor jumps to the anchor and the anchor stays where the cursor was.
		o: () => {
			const items = rows();
			const from = items.findIndex((item) => idOf(item) === anchor);
			const here = idOf(active());
			if (from < 0 || !here) return;
			anchor = here;
			focus(items, from);
			actions.mark?.(range());
		},
		x: onRun((ids) => actions.cut?.(ids)),
		d: onRun((ids, first) => void trash(ids, first)),
		y: onRun((ids) => actions.copy?.(ids)),
		'?': () => actions.help()
	};

	// Handlers read `machine` only when a key runs them, so it can be made after the keymaps.
	const machine = createModal(
		{ normal, visual },
		{
			onMode(next) {
				if (next === 'visual') actions.mark?.(range());
				else {
					anchor = null;
					actions.mark?.([]);
				}
			}
		}
	);

	function keydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (
			event.defaultPrevented ||
			event.isComposing ||
			target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]') ||
			target.closest('[role="dialog"]') ||
			document.querySelector(
				'[role="dialog"][aria-modal="true"],[role="alertdialog"],[role="menu"],[role="listbox"]'
			)
		) {
			machine.reset();
			return;
		}
		if (event.metaKey || event.altKey) return;
		// A list that no longer holds the anchor (a new view, a search) ends visual mode.
		if (machine.mode() === 'visual' && !range().length) machine.reset();
		const key = keyOf(event);
		if (key && machine.feed(key)) event.preventDefault();
	}
	return {
		keydown,
		/** Back to normal mode with nothing marked, e.g. when the view changes. */
		reset: () => machine.reset(),
		mode: (): Mode => machine.mode()
	};
}
