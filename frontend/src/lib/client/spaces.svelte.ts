import { defaultSpaceId, groupTags, spaceOf, type FolderGroup } from './workflows.js';

type Row = Record<string, unknown>;
const KEY = 'prism:space';

/* The active space id, persisted per device. */
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
/* The remembered space if it still exists, otherwise the default. */
export function resolveSpaceId(spaces: Row[], remembered: string): string {
	return remembered && spaces.some((s) => s.id === remembered)
		? remembered
		: defaultSpaceId(spaces);
}
/* Folders and loose tags in a space. Tags follow their folder; unplaced items belong to the default. */
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
