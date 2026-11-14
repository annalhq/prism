/**
 * A small modal key engine after Vim: a mode, a pending key sequence and a count, nothing else.
 *
 * Keys arrive in Vim notation (`j`, `G`, `<C-d>`, `<Down>`, `<Esc>`). Each mode has its own
 * keymap of sequences (`gg`, `dd`) to handlers. A key that only starts a longer sequence waits
 * for the next one; an exact match that is also a prefix waits `timeout` ms (Vim's timeoutlen)
 * before running. Digits before a command are its count (`3j`, `5G`).
 *
 * `<Esc>` is built in, the same in every mode: it drops a pending sequence or count first, then
 * returns to normal mode. In normal mode with nothing pending it is not consumed, so whatever
 * else listens (the omnibar) still gets it.
 *
 * A handler returns the mode to switch to, nothing to stay, or `false` when the key turned out
 * not to apply here; then it is not consumed and passes through to the page.
 */
export type Mode = 'normal' | 'visual';
export type Handler = (count: number | null) => Mode | false | void;
export type Keymap = Record<Mode, Record<string, Handler>>;

const SEPARATOR = '␟';
// `gg` → [g, g]; `<C-d>` → [<C-d>]; a lone `<` stays a literal key.
export function parseKeys(sequence: string): string[] {
	return sequence.match(/<[^<>\s]+>|./gu) ?? [];
}
export function keyOf(event: Pick<KeyboardEvent, 'key' | 'ctrlKey'>): string | null {
	const special: Record<string, string> = {
		ArrowDown: '<Down>',
		ArrowUp: '<Up>',
		Escape: '<Esc>',
		Enter: '<CR>',
		' ': '<Space>'
	};
	if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return null;
	if (event.ctrlKey) return event.key.length === 1 ? `<C-${event.key.toLowerCase()}>` : null;
	return special[event.key] ?? (event.key.length === 1 ? event.key : null);
}

export function createModal(
	keymap: Keymap,
	{
		timeout = 1000,
		onMode
	}: { timeout?: number; onMode?: (next: Mode, previous: Mode) => void } = {}
) {
	// Each mode's sequences as token lists, joined so prefixes compare as plain strings.
	const tables = Object.fromEntries(
		Object.entries(keymap).map(([mode, map]) => [
			mode,
			new Map(Object.entries(map).map(([keys, run]) => [parseKeys(keys).join(SEPARATOR), run]))
		])
	) as Record<Mode, Map<string, Handler>>;
	let mode: Mode = 'normal',
		pending: string[] = [],
		count = '',
		timer: ReturnType<typeof setTimeout> | undefined;

	const clear = () => {
		pending = [];
		count = '';
		clearTimeout(timer);
	};
	const enter = (next: Mode) => {
		if (next === mode) return;
		const previous = mode;
		mode = next;
		onMode?.(next, previous);
	};
	const run = (handler: Handler) => {
		const n = count ? Number(count) : null;
		clear();
		const next = handler(n);
		if (next === false) return false;
		if (next) enter(next);
		return true;
	};

	/** Feeds one key; true when the machine consumed it. */
	function feed(key: string): boolean {
		if (key === '<Esc>' || key === '<C-[>') {
			if (pending.length || count) {
				clear();
				return true;
			}
			if (mode !== 'normal') {
				enter('normal');
				return true;
			}
			return false;
		}
		const table = tables[mode];
		if (!pending.length && /^[0-9]$/.test(key) && (count || key !== '0') && !table.has(key)) {
			count += key;
			return true;
		}
		const sequence = [...pending, key].join(SEPARATOR);
		const exact = table.get(sequence);
		const longer = [...table.keys()].some(
			(keys) => keys.length > sequence.length && keys.startsWith(sequence + SEPARATOR)
		);
		if (longer) {
			pending = [...pending, key];
			clearTimeout(timer);
			timer = setTimeout(() => (exact ? run(exact) : clear()), timeout);
			return true;
		}
		if (exact) return run(exact);
		// An unknown sequence is abandoned, and swallows its key, as in Vim (`dz` does nothing).
		const aborted = pending.length > 0 || count !== '';
		clear();
		return aborted;
	}

	return {
		feed,
		mode: () => mode,
		/** Switches mode directly (runs the hooks), dropping anything pending. */
		set(next: Mode) {
			clear();
			enter(next);
		},
		/** Back to a clean normal mode. */
		reset() {
			clear();
			enter('normal');
		}
	};
}
