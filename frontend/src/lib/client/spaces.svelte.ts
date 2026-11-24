// Sidebar spaces: which one is showing on this device, and what each one shows.
import { defaultSpaceId, groupTags, spaceOf, type FolderGroup } from './workflows.js';

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
/** The space to show: the remembered one while it still exists, else the default ('' for none). */
export function resolveSpaceId(spaces: Row[], remembered: string): string {
	return remembered && spaces.some((s) => s.id === remembered)
		? remembered
		: defaultSpaceId(spaces);
}
/**
 * The folders and loose tags one space shows, in the order given. A tag in a folder goes where
 * its folder goes; anything unplaced shows in the default space.
 */
export function shelfFor(
	id: string,
	tags: Row[],
	folders: Row[],
	spaces: Row[]
): { groups: FolderGroup[]; loose: Row[] } {
	return groupTags(
		tags.filter((t) => spaceOf(t, folders, spaces) === id),
		folders.filter((f) => spaceOf(f, folders, spaces) === id)
	);
}
