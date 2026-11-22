// How the library sidebar lays out its views, kept per device (Settings → Appearance).

export type SidebarView = 'all' | 'later' | 'people' | 'trash' | 'highlights';
export type SidebarMode = 'list' | 'quad';

export const SIDEBAR_VIEWS: readonly SidebarView[] = [
	'all',
	'later',
	'people',
	'trash',
	'highlights'
];
/** List mode's first section; Trash lives in the footer and Highlights under its tag. */
export const LIST_VIEWS: readonly SidebarView[] = ['all', 'later', 'people'];
const DEFAULT_QUAD: SidebarView[] = ['all', 'later', 'people', 'highlights'];
const KEY = 'prism:sidebar-layout';

export const sidebarPreference = $state<{ mode: SidebarMode; quad: SidebarView[] }>({
	mode: 'list',
	quad: [...DEFAULT_QUAD]
});

function valid(quad: unknown): quad is SidebarView[] {
	return (
		Array.isArray(quad) &&
		quad.length >= 1 &&
		quad.length <= 4 &&
		new Set(quad).size === quad.length &&
		quad.every((id) => (SIDEBAR_VIEWS as readonly unknown[]).includes(id))
	);
}
function persist() {
	try {
		localStorage.setItem(KEY, JSON.stringify(sidebarPreference));
	} catch {
		/* Device storage is optional. */
	}
}
export function initializeSidebarPreference() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (saved?.mode === 'quad' || saved?.mode === 'list') sidebarPreference.mode = saved.mode;
		if (valid(saved?.quad)) sidebarPreference.quad = saved.quad;
	} catch {
		/* Use defaults. */
	}
}
export function setSidebarMode(mode: SidebarMode) {
	sidebarPreference.mode = mode;
	persist();
}
/** The chosen tiles in a fixed order. */
export function quadViews(): SidebarView[] {
	return SIDEBAR_VIEWS.filter((id) => sidebarPreference.quad.includes(id));
}
export const MAX_QUAD = 4;
/** Adds or removes a quad tile; at least one and at most four show. */
export function toggleQuadView(id: SidebarView) {
	const quad = sidebarPreference.quad;
	if (quad.includes(id)) {
		if (quad.length > 1) sidebarPreference.quad = quad.filter((v) => v !== id);
	} else if (quad.length < MAX_QUAD) sidebarPreference.quad = [...quad, id];
	persist();
}
