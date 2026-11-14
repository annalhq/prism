import {
	MAX_THEME_BYTES,
	THEME_FORMAT,
	builtinTheme,
	parseThemeDocument,
	ThemeError,
	type BuiltinThemeId,
	type ThemeDocument,
	type ThemeKind,
	type ThemeScheme
} from '#lib/domain/theme.js';
import { downloadFile } from './download.js';

/** Reads a dropped or picked file as a theme document; throws with a readable message. */
export async function readThemeFile(file: File): Promise<ThemeDocument> {
	if (file.size > MAX_THEME_BYTES) throw new Error(`${file.name} is larger than 16 KB.`);
	let json: unknown;
	try {
		json = JSON.parse(await file.text());
	} catch {
		throw new Error(`${file.name} is not valid JSON.`);
	}
	try {
		return parseThemeDocument(json);
	} catch (error) {
		throw new Error(error instanceof ThemeError ? `${file.name}: ${error.message}` : String(error));
	}
}

const fileName = (name: string) =>
	`${
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'theme'
	}.json`;

/** Downloads a document; built-in themes export a starter template. */
export function exportTheme(theme: ThemeDocument | BuiltinThemeId) {
	const document = typeof theme === 'string' ? builtinTemplate(theme) : theme;
	downloadFile(
		JSON.stringify({ $schema: '/themes/theme.schema.json', ...document }, null, '\t'),
		fileName(document.name),
		'application/json'
	);
}

/** A palette-based starting point with the built-in theme's colours. */
function builtinTemplate(id: BuiltinThemeId): ThemeDocument {
	const { name, scheme, swatch } = builtinTheme(id)!;
	return {
		prism: THEME_FORMAT,
		kind: 'theme',
		name: `${name} copy`,
		scheme,
		palette: { background: swatch.canvas, foreground: swatch.ink, accent: swatch.accent }
	};
}

export type GalleryEntry = {
	file: string;
	name: string;
	kind: ThemeKind;
	scheme?: ThemeScheme;
	description?: string;
	swatch?: { canvas: string; ink: string; accent: string };
};

let gallery: Promise<GalleryEntry[]> | undefined;
/** The bundled gallery index, fetched once and only when asked for. */
export function loadGallery(): Promise<GalleryEntry[]> {
	gallery ??= fetch('/themes/index.json')
		.then((response) => {
			if (!response.ok) throw new Error('Could not load the theme gallery.');
			return response.json() as Promise<{ themes: GalleryEntry[] }>;
		})
		.then((index) => index.themes)
		.catch((error) => {
			gallery = undefined;
			throw error;
		});
	return gallery;
}

export async function loadGalleryTheme(entry: GalleryEntry): Promise<ThemeDocument> {
	const response = await fetch(`/themes/${entry.file}`);
	if (!response.ok) throw new Error(`Could not load ${entry.name}.`);
	return parseThemeDocument(await response.json());
}
