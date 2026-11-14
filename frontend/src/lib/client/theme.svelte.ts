import { restoreAppearance } from './appearance.svelte.js';

// Square corners: some people prefer a flat, squared look over the rounded one. Also mirrored
// in app.html so the first paint already has the chosen corners.
export const cornersPreference = $state<{ square: boolean }>({ square: false });
function applyCorners(square: boolean) {
	if (square) document.documentElement.dataset.corners = 'square';
	else delete document.documentElement.dataset.corners;
}
export function setSquareCorners(square: boolean) {
	cornersPreference.square = square;
	applyCorners(square);
	try {
		localStorage.setItem('prism:corners', square ? 'square' : 'round');
	} catch {
		/* Device storage is optional. */
	}
}
// Minimal list: bookmarks as one centred column of single lines (icon, title, site) instead of
// the default icon · title · site · date columns. Also mirrored in app.html for the first paint.
export const listPreference = $state<{ minimal: boolean }>({ minimal: false });
function applyList(minimal: boolean) {
	if (minimal) document.documentElement.dataset.list = 'minimal';
	else delete document.documentElement.dataset.list;
}
export function setMinimalList(minimal: boolean) {
	listPreference.minimal = minimal;
	applyList(minimal);
	try {
		localStorage.setItem('prism:list', minimal ? 'minimal' : 'columns');
	} catch {
		/* Device storage is optional. */
	}
}
// The bar above the list (sort and shortcuts) can be hidden. Also mirrored in app.html.
export const toolbarPreference = $state<{ hidden: boolean }>({ hidden: false });
function applyToolbar(hidden: boolean) {
	if (hidden) document.documentElement.dataset.toolbar = 'hidden';
	else delete document.documentElement.dataset.toolbar;
}
export function setToolbarHidden(hidden: boolean) {
	toolbarPreference.hidden = hidden;
	applyToolbar(hidden);
	try {
		localStorage.setItem('prism:toolbar', hidden ? 'hidden' : 'shown');
	} catch {
		/* Device storage is optional. */
	}
}
export function initializeTheme() {
	try {
		cornersPreference.square = localStorage.getItem('prism:corners') === 'square';
		listPreference.minimal = localStorage.getItem('prism:list') === 'minimal';
		toolbarPreference.hidden = localStorage.getItem('prism:toolbar') === 'hidden';
	} catch {
		/* Use default. */
	}
	restoreAppearance();
	applyCorners(cornersPreference.square);
	applyList(listPreference.minimal);
	applyToolbar(toolbarPreference.hidden);
}
