import { APPEARANCE_ID } from '#lib/domain/appearance.js';
import { sortByPosition } from '#lib/domain/organization.js';
import {
	builtinTheme,
	compileAppearance,
	parseThemeDocument,
	type BuiltinThemeId,
	type CompiledAppearance,
	type ThemeDocument,
	type ThemeScheme
} from '#lib/domain/theme.js';

type Row = Record<string, unknown>;
type Reader = { list<T>(table: 'themes' | 'appearance'): T[] };

// Mirrored by the bootstrap script in app.html, which applies it before first paint.
const CACHE_KEY = 'prism:appearance';
const LEGACY_KEY = 'prism:theme';
const STYLE_ID = 'prism-theme';

export const appearance = $state<{ scheme: ThemeScheme; activeTheme: string }>({
	scheme: 'dark',
	activeTheme: 'zen-dark'
});
let applied = '';

function legacyTheme(): BuiltinThemeId {
	try {
		return localStorage.getItem(LEGACY_KEY) === 'light' ? 'zen-light' : 'zen-dark';
	} catch {
		return 'zen-dark';
	}
}

export function applyAppearance(compiled: CompiledAppearance) {
	const key = `${compiled.scheme}|${compiled.themeColor}|${compiled.css}`;
	appearance.scheme = compiled.scheme;
	if (key === applied) return;
	applied = key;
	const root = document.documentElement;
	root.dataset.theme = compiled.scheme;
	let style = document.getElementById(STYLE_ID);
	if (!style) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		document.head.append(style);
	}
	style.textContent = compiled.css;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', compiled.themeColor);
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, ...compiled }));
	} catch {
		/* Device storage is optional. */
	}
}

/** Re-applies the cached appearance, for pages without a library. */
export function restoreAppearance() {
	try {
		const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
		if (cached?.v === 1 && typeof cached.css === 'string') {
			applyAppearance({
				scheme: cached.scheme === 'light' ? 'light' : 'dark',
				css: cached.css,
				themeColor: String(cached.themeColor)
			});
			return;
		}
	} catch {
		/* Fall back to the legacy preference. */
	}
	applyAppearance(compileAppearance(legacyTheme()));
}

export type InstalledTheme = { row: Row; document: ThemeDocument };

// Replica rows are replaced on change, so a row object maps to one parse.
const parsed = new WeakMap<Row, ThemeDocument | null>();
function documentOf(row: Row): ThemeDocument | null {
	if (!parsed.has(row)) {
		try {
			parsed.set(row, parseThemeDocument(row.document));
		} catch {
			parsed.set(row, null);
		}
	}
	return parsed.get(row)!;
}

/** Installed themes and modules with valid documents, modules in stacking order. */
export function installedThemes(library: Reader) {
	const valid: InstalledTheme[] = [];
	for (const row of sortByPosition(library.list<Row>('themes'))) {
		const document = row.deletedAt ? null : documentOf(row);
		if (document) valid.push({ row, document });
	}
	return {
		themes: valid.filter((entry) => entry.document.kind === 'theme'),
		modules: valid.filter((entry) => entry.document.kind === 'module')
	};
}

/** The active theme id; without a synced choice, this device's previous preference. */
export function activeThemeId(library: Reader): string {
	const record = library.list<Row>('appearance').find((row) => row.id === APPEARANCE_ID);
	return typeof record?.activeTheme === 'string' ? record.activeTheme : legacyTheme();
}

/** Compiles and applies the library's appearance. Cheap when nothing changed. */
export function syncAppearance(library: Reader) {
	const { themes, modules } = installedThemes(library);
	const id = activeThemeId(library);
	const installed = themes.find((entry) => entry.row.id === id);
	const theme = installed?.document ?? (builtinTheme(id) ? (id as BuiltinThemeId) : undefined);
	appearance.activeTheme = theme ? id : legacyTheme();
	applyAppearance(
		compileAppearance(
			theme ?? legacyTheme(),
			modules.filter((entry) => entry.row.enabled !== false).map((entry) => entry.document)
		)
	);
}
