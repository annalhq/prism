// Normal-mode shortcuts never intercept text entry, IME composition, or an overlay.
// Visual mode (`v`) marks a run of bookmarks from an anchor to the focused row, as in Vim;
// `x` cuts it to a destination, `d` trashes it, `y` copies its links and Escape lets go.
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
	let lastG = 0,
		lastD = 0,
		anchor: string | null = null;
	const rows = () => [...document.querySelectorAll<HTMLElement>('.bookmark-title, .person-card')];
	const idOf = (element: Element | null | undefined) =>
		element?.closest<HTMLElement>('[data-bookmark-id]')?.dataset.bookmarkId ?? null;
	const focus = (items: HTMLElement[], index: number) => {
		const item = items[Math.max(0, Math.min(items.length - 1, index))];
		item?.focus({ preventScroll: true });
		item?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
	};
	// The marked run, from the anchor to the focused row in either direction.
	const range = () => {
		const items = rows();
		const from = items.findIndex((item) => idOf(item) === anchor);
		const to = items.indexOf(document.activeElement as HTMLElement);
		if (from < 0) return [];
		const [start, end] = to < 0 ? [from, from] : [Math.min(from, to), Math.max(from, to)];
		return items
			.slice(start, end + 1)
			.map(idOf)
			.filter((id): id is string => !!id);
	};
	const leaveVisual = () => {
		if (anchor === null) return;
		anchor = null;
		actions.mark?.([]);
	};
	// After a motion the run follows the cursor; a list that lost the anchor ends the mode.
	const extend = () => {
		if (anchor === null) return;
		const ids = range();
		if (ids.length) actions.mark?.(ids);
		else leaveVisual();
	};
	// Trashed rows leave the list; the cursor lands on whatever took the first one's place.
	const removeAndRefocus = async (ids: string[], index: number) => {
		await actions.remove?.(ids);
		requestAnimationFrame(() => focus(rows(), index));
	};
	return (event: KeyboardEvent) => {
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
			lastG = lastD = 0;
			return;
		}
		if (event.metaKey || event.altKey || (event.ctrlKey && !['d', 'u'].includes(event.key))) return;
		const items = rows();
		const current = items.indexOf(document.activeElement as HTMLElement);
		const row = target.closest('.bookmark-gesture');
		if (anchor !== null && !range().length) leaveVisual();
		if (event.ctrlKey) {
			event.preventDefault();
			const step = Math.max(
				1,
				Math.floor(
					(document.querySelector('.library-content')?.clientHeight || innerHeight) /
						2 /
						(row?.getBoundingClientRect().height || 52)
				)
			);
			focus(items, Math.max(0, current) + (event.key === 'd' ? step : -step));
			extend();
			return;
		}
		if (event.key === 'g') {
			event.preventDefault();
			lastD = 0;
			if (performance.now() - lastG < 650 && lastG) {
				focus(items, 0);
				extend();
				lastG = 0;
			} else lastG = performance.now();
			return;
		}
		lastG = 0;
		if (event.key !== 'd') lastD = 0;
		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				focus(items, current + 1);
				extend();
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				focus(items, current < 0 ? items.length - 1 : current - 1);
				extend();
				break;
			case 'G':
				event.preventDefault();
				focus(items, items.length - 1);
				extend();
				break;
			case 'v':
			case 'V': {
				event.preventDefault();
				if (anchor !== null) {
					leaveVisual();
					break;
				}
				const id = idOf(target);
				if (!id || !actions.mark) break;
				anchor = id;
				actions.mark([id]);
				break;
			}
			case 'Escape':
				if (anchor !== null) {
					event.preventDefault();
					leaveVisual();
				}
				break;
			case 'x': {
				const ids = anchor !== null ? range() : [idOf(target)].filter((id) => id !== null);
				if (!ids.length || !actions.cut) break;
				event.preventDefault();
				leaveVisual();
				actions.cut(ids);
				break;
			}
			case 'd': {
				// Visual `d` trashes the run; in normal mode it takes `dd`, so one stray key is harmless.
				const start = Math.max(0, current);
				if (anchor !== null) {
					event.preventDefault();
					const ids = range();
					const first = items.findIndex((item) => ids.includes(idOf(item) ?? ''));
					leaveVisual();
					void removeAndRefocus(ids, first < 0 ? start : first);
					break;
				}
				const id = idOf(target);
				if (!id || !actions.remove) break;
				event.preventDefault();
				if (lastD && performance.now() - lastD < 650) {
					lastD = 0;
					void removeAndRefocus([id], start);
				} else lastD = performance.now();
				break;
			}
			case 'i':
				event.preventDefault();
				leaveVisual();
				actions.insert();
				break;
			case 'f':
				event.preventDefault();
				leaveVisual();
				actions.filter();
				break;
			case ',':
				event.preventDefault();
				leaveVisual();
				actions.account();
				break;
			case '?':
				event.preventDefault();
				actions.help();
				break;
			case 'o': {
				event.preventDefault();
				const open = row?.querySelector<HTMLButtonElement>('.bookmark-open');
				if (open) open.click();
				else items[current]?.click();
				break;
			}
			case 'e':
			case ' ':
				if (row && (event.key === 'e' || target.matches('.bookmark-title'))) {
					event.preventDefault();
					row.querySelector<HTMLButtonElement>('.bookmark-edit')?.click();
				}
				break;
			case 'y':
				if (anchor !== null) {
					event.preventDefault();
					actions.copy?.(range());
					leaveVisual();
				} else if (row) {
					event.preventDefault();
					row.querySelector<HTMLButtonElement>('.bookmark-copy')?.click();
				}
				break;
		}
	};
}
