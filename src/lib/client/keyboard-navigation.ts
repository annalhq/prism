// Normal-mode shortcuts never intercept text entry, IME composition, or an overlay.
export function libraryKeyboard(actions: {
	insert: () => void;
	filter: () => void;
	account: () => void;
	help: () => void;
}) {
	let lastG = 0;
	const rows = () => [...document.querySelectorAll<HTMLElement>('.bookmark-title, .person-card')];
	const focus = (items: HTMLElement[], index: number) => {
		const item = items[Math.max(0, Math.min(items.length - 1, index))];
		item?.focus({ preventScroll: true });
		item?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
	};
	return (event: KeyboardEvent) => {
		const target = event.target as HTMLElement;
		if (
			event.defaultPrevented ||
			event.isComposing ||
			target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]') ||
			document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')
		) {
			lastG = 0;
			return;
		}
		if (event.metaKey || event.altKey || (event.ctrlKey && !['d', 'u'].includes(event.key))) return;
		const items = rows();
		const current = items.indexOf(document.activeElement as HTMLElement);
		const row = target.closest('.bookmark-gesture');
		if (event.ctrlKey) {
			event.preventDefault();
			const step = Math.max(
				1,
				Math.floor(innerHeight / 2 / (row?.getBoundingClientRect().height || 52))
			);
			focus(items, Math.max(0, current) + (event.key === 'd' ? step : -step));
			return;
		}
		if (event.key === 'g') {
			event.preventDefault();
			if (performance.now() - lastG < 650 && lastG) {
				focus(items, 0);
				lastG = 0;
			} else lastG = performance.now();
			return;
		}
		lastG = 0;
		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				focus(items, current + 1);
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				focus(items, current < 0 ? items.length - 1 : current - 1);
				break;
			case 'G':
				event.preventDefault();
				focus(items, items.length - 1);
				break;
			case 'i':
				event.preventDefault();
				actions.insert();
				break;
			case 'f':
				event.preventDefault();
				actions.filter();
				break;
			case ',':
				event.preventDefault();
				actions.account();
				break;
			case '?':
				event.preventDefault();
				actions.help();
				break;
			case 'o':
				event.preventDefault();
				items[current]?.click();
				break;
			case 'e':
			case ' ':
				if (row && (event.key === 'e' || target.matches('.bookmark-title'))) {
					event.preventDefault();
					row.querySelector<HTMLButtonElement>('.bookmark-edit')?.click();
				}
				break;
			case 'y':
				if (row) {
					event.preventDefault();
					row.querySelector<HTMLButtonElement>('.bookmark-copy')?.click();
				}
				break;
			case 'x':
				if (row) {
					event.preventDefault();
					row.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click();
				}
				break;
		}
	};
}
