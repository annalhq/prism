// Sidebar spaces: which one is showing on this device.

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
