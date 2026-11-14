import { SvelteSet } from 'svelte/reactivity';

// Pure grouping lives with the other workflows; re-exported for the components.
export { folderOf, groupTags, type FolderGroup } from './workflows.js';

/**
 * Which folders are folded shut in one view, kept per device. New folders start open.
 * Restore after mount, so server and first client render agree.
 */
export class FolderState {
	readonly closed = new SvelteSet<string>();
	#restored = false;
	constructor(private readonly key: string) {}

	isOpen(id: string) {
		return !this.closed.has(id);
	}
	setOpen(id: string, open: boolean) {
		if (open) this.closed.delete(id);
		else this.closed.add(id);
		try {
			localStorage.setItem(this.key, JSON.stringify([...this.closed]));
		} catch {
			/* Optional preference. */
		}
	}
	restore() {
		if (this.#restored) return;
		this.#restored = true;
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(this.key) ?? '[]');
			if (Array.isArray(saved))
				for (const id of saved) if (typeof id === 'string') this.closed.add(id);
		} catch {
			/* Optional preference. */
		}
	}
}

export const sidebarFolders = new FolderState('prism:folders-closed');
export const tagsPageFolders = new FolderState('prism:tags-page-folders-closed');
