// Sidebar spaces: which one is showing on this device, and how each is drawn.

type Row = Record<string, unknown>;

const KEY = 'prism:space';

/** The space showing in the sidebar; '' is Home. Restored after mount, kept per device. */
export const activeSpace = $state<{ id: string }>({ id: '' });

export function restoreSpace() {
	try {
		activeSpace.id = localStorage.getItem(KEY) ?? '';
	} catch {
		/* Optional preference. */
	}
}
export function showSpace(id: string) {
	activeSpace.id = id;
	try {
		localStorage.setItem(KEY, id);
	} catch {
		/* Optional preference. */
	}
}

/** A space's OKLCH hue: the chosen one, or one derived from its name. Home has none. */
export function spaceHue(space: Row | null | undefined): number | null {
	if (!space?.id) return null;
	if (typeof space.hue === 'number') return space.hue;
	let hash = 0;
	for (const char of String(space.name).toLocaleLowerCase())
		hash = (hash * 31 + char.codePointAt(0)!) | 0;
	return Math.abs(hash) % 360;
}
export function hueColor(hue: number | null): string {
	return hue === null ? 'var(--secondary)' : `oklch(0.68 0.12 ${hue})`;
}
export function spaceColor(space: Row | null | undefined): string {
	return hueColor(spaceHue(space));
}
/** The first letter of a space's name, for its chip. */
export function spaceInitial(name: unknown): string {
	return [...String(name ?? '').trim()][0]?.toLocaleUpperCase() ?? '·';
}
