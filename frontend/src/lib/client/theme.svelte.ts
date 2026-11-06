export type Theme = 'dark' | 'light';
// Mirrors the bootstrap script in app.html, which applies the stored theme before first paint.
const themeColors: Record<Theme, string> = { dark: '#121212', light: '#f7f5ef' };
export const themePreference = $state<{ value: Theme }>({ value: 'dark' });
function apply(theme: Theme) {
	document.documentElement.dataset.theme = theme;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
}
export function setTheme(theme: Theme) {
	themePreference.value = theme;
	apply(theme);
	try {
		localStorage.setItem('prism:theme', theme);
	} catch {
		/* Device storage is optional. */
	}
}
export function initializeTheme() {
	try {
		themePreference.value = localStorage.getItem('prism:theme') === 'light' ? 'light' : 'dark';
	} catch {
		/* Use default. */
	}
	apply(themePreference.value);
}
