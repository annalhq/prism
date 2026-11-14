import { SvelteSet } from 'svelte/reactivity';

// Pure grouping lives with the other workflows; re-exported for the components.
export { folderOf, groupTags, type FolderGroup } from './workflows.js';

// Which folders are folded shut, shared by the sidebar and the tags page and kept per device.
// New folders start open. Restored after mount, so server and first client render agree.
const KEY = 'prism:folders-closed';
export const closedFolders = new SvelteSet<string>();
let restored = false;
export function restoreFolders() {
	if (restored) return;
	restored = true;
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		if (Array.isArray(saved))
			for (const id of saved) if (typeof id === 'string') closedFolders.add(id);
	} catch {
		/* Optional preference. */
	}
}
export function setFolderOpen(id: string, open: boolean) {
	if (open) closedFolders.delete(id);
	else closedFolders.add(id);
	try {
		localStorage.setItem(KEY, JSON.stringify([...closedFolders]));
	} catch {
		/* Optional preference. */
	}
}
