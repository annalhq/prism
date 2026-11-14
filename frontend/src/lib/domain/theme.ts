// Theme and module documents: parsing (shared by client and server) and compilation to CSS.
// Only registry tokens with validated values are emitted. Guide: .github/theming.md

export const THEME_FORMAT = 1;
export const MAX_THEME_BYTES = 16_384;

export type ThemeScheme = 'dark' | 'light';
export type ThemeKind = 'theme' | 'module';

/** Colour tokens a theme may set (CSS variable names without `--`). */
export const COLOR_TOKENS = [
	'canvas',
	'surface',
	'field',
	'elevated',
	'sheet',
	'card',
	'hover',
	'active',
	'pressed',
	'selection',
	'ink',
	'muted-ink',
	'secondary',
	'tertiary',
	'line',
	'hairline',
	'highlight',
	'accent',
	'accent-hover',
	'on-accent',
	'scrim',
	'danger',
	'warning',
	'shadow-faint',
	'shadow-soft',
	'shadow-strong',
	'switch-off',
	'switch-knob',
	'switch-on',
	'switch-on-knob',
	'cover-glow',
	'cover-base',
	'warm-white'
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export const PALETTE_KEYS = ['background', 'foreground', 'accent', 'danger', 'warning'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export const RADIUS_KEYS = ['sm', 'control', 'card', 'panel'] as const;
export type RadiusKey = (typeof RADIUS_KEYS)[number];

export const FONT_KEYS = ['sans', 'mono', 'display'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

/** Base type scale in px, mirroring app.css. */
const TYPE_SCALE = {
	xs: 11,
	sm: 12,
	md: 13,
	base: 14,
	body: 15,
	lg: 16,
	xl: 20,
	title: 22,
	'2xl': 28,
	display: 34
} as const;
const FONT_FALLBACKS: Record<FontKey, string> = {
	sans: 'system-ui, sans-serif',
	mono: "ui-monospace, 'SF Mono', Menlo, monospace",
	display: "'Iowan Old Style', Georgia, serif"
};
export const SCALE_RANGE = [0.85, 1.25] as const;
export const RADIUS_RANGE = [0, 40] as const;

export type ThemeDocument = {
	prism: typeof THEME_FORMAT;
	kind: ThemeKind;
	name: string;
	author?: string;
	description?: string;
	/** Required for themes; absent for modules. */
	scheme?: ThemeScheme;
	palette?: Partial<Record<PaletteKey, string>>;
	colors?: Partial<Record<ColorToken, string>>;
	shape?: { radius?: Partial<Record<RadiusKey, number>> };
	typography?: Partial<Record<FontKey, string>> & { scale?: number };
};

/** Themes defined in app.css. */
export const BUILTIN_THEMES = [
	{
		id: 'zen-dark',
		name: 'Zen dark',
		scheme: 'dark',
		swatch: { canvas: '#121212', ink: '#efeeeb', accent: '#f4f2ec' }
	},
	{
		id: 'zen-light',
		name: 'Zen light',
		scheme: 'light',
		swatch: { canvas: '#f7f5ef', ink: '#26251e', accent: '#26251e' }
	}
] as const satisfies readonly {
	id: string;
	name: string;
	scheme: ThemeScheme;
	swatch: { canvas: string; ink: string; accent: string };
}[];
export type BuiltinThemeId = (typeof BUILTIN_THEMES)[number]['id'];
export const DEFAULT_THEME: BuiltinThemeId = 'zen-dark';
export function builtinTheme(id: unknown) {
	return BUILTIN_THEMES.find((theme) => theme.id === id);
}

// ---------------------------------------------------------------------------------------------
// Parsing

export class ThemeError extends Error {
	constructor(
		readonly path: string,
		message: string
	) {
		super(path ? `${path}: ${message}` : message);
	}
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Numeric arguments only: rejects nesting, var(), url() and declaration breakouts.
const COLOR_FUNCTION =
	/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?:[\s,/%.+-]|\d|deg|rad|grad|turn|none|e)*\)$/i;
const FONT_FAMILY = /^[\p{L}\p{N} ._-]{1,64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
	for (const key of Object.keys(value))
		if (!allowed.includes(key))
			throw new ThemeError(path ? `${path}.${key}` : key, 'not a known setting');
}
function section(value: unknown, path: string): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new ThemeError(path, 'expected an object');
	return value;
}
function text(value: unknown, path: string, max: number, required = false): string | undefined {
	if (value === undefined && !required) return undefined;
	if (typeof value !== 'string' || !value.trim() || value.length > max)
		throw new ThemeError(path, `expected text of 1–${max} characters`);
	return value.trim();
}
function color(value: unknown, path: string): string {
	if (
		typeof value !== 'string' ||
		value.length > 96 ||
		!(HEX.test(value) || COLOR_FUNCTION.test(value) || value === 'transparent')
	)
		throw new ThemeError(path, 'not a colour (use #hex, rgb(), hsl() or oklch())');
	return value;
}
function colors<K extends string>(
	value: unknown,
	keys: readonly K[],
	path: string
): Partial<Record<K, string>> | undefined {
	const record = section(value, path);
	if (!record) return undefined;
	onlyKeys(record, keys, path);
	return Object.fromEntries(
		Object.entries(record).map(([key, entry]) => [key, color(entry, `${path}.${key}`)])
	) as Partial<Record<K, string>>;
}
function fontList(value: unknown, path: string): string | undefined {
	const raw = text(value, path, 200);
	if (raw === undefined) return undefined;
	const families = raw.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, ''));
	if (families.length > 4 || families.some((family) => !FONT_FAMILY.test(family)))
		throw new ThemeError(path, 'expected up to 4 installed font family names');
	return families.join(', ');
}
function number(value: unknown, path: string, [low, high]: readonly [number, number]): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
		throw new ThemeError(path, `expected a number from ${low} to ${high}`);
	return value;
}

/** Returns a normalised copy of a theme or module, or throws a ThemeError. */
export function parseThemeDocument(input: unknown): ThemeDocument {
	if (!isRecord(input)) throw new ThemeError('', 'A theme file is a JSON object.');
	if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_THEME_BYTES)
		throw new ThemeError('', `A theme file must be under ${MAX_THEME_BYTES / 1024} KB.`);
	onlyKeys(
		input,
		[
			'$schema',
			'prism',
			'kind',
			'name',
			'author',
			'description',
			'scheme',
			'palette',
			'colors',
			'shape',
			'typography'
		],
		''
	);
	if (input.prism !== THEME_FORMAT)
		throw new ThemeError('prism', `expected format version ${THEME_FORMAT}`);
	const kind = input.kind ?? 'theme';
	if (kind !== 'theme' && kind !== 'module')
		throw new ThemeError('kind', 'expected "theme" or "module"');
	const document: ThemeDocument = {
		prism: THEME_FORMAT,
		kind,
		name: text(input.name, 'name', 64, true)!
	};
	const author = text(input.author, 'author', 120);
	const description = text(input.description, 'description', 160);
	if (author) document.author = author;
	if (description) document.description = description;
	if (kind === 'theme') {
		if (input.scheme !== 'dark' && input.scheme !== 'light')
			throw new ThemeError('scheme', 'a theme needs "dark" or "light"');
		document.scheme = input.scheme;
	} else if (input.scheme !== undefined)
		throw new ThemeError('scheme', 'modules follow the active theme and take no scheme');
	const palette = colors(input.palette, PALETTE_KEYS, 'palette');
	if (palette) {
		if (!palette.background || !palette.foreground)
			throw new ThemeError('palette', 'needs at least background and foreground');
		document.palette = palette;
	}
	const tokens = colors(input.colors, COLOR_TOKENS, 'colors');
	if (tokens) document.colors = tokens;
	const shape = section(input.shape, 'shape');
	if (shape) {
		onlyKeys(shape, ['radius'], 'shape');
		const radius = section(shape.radius, 'shape.radius');
		if (radius) {
			onlyKeys(radius, RADIUS_KEYS, 'shape.radius');
			document.shape = {
				radius: Object.fromEntries(
					Object.entries(radius).map(([key, value]) => [
						key,
						Math.round(number(value, `shape.radius.${key}`, RADIUS_RANGE))
					])
				)
			};
		}
	}
	const typography = section(input.typography, 'typography');
	if (typography) {
		onlyKeys(typography, [...FONT_KEYS, 'scale'], 'typography');
		const type: NonNullable<ThemeDocument['typography']> = {};
		for (const key of FONT_KEYS) {
			const family = fontList(typography[key], `typography.${key}`);
			if (family) type[key] = family;
		}
		if (typography.scale !== undefined)
			type.scale = number(typography.scale, 'typography.scale', SCALE_RANGE);
		document.typography = type;
	}
	return document;
}

// ---------------------------------------------------------------------------------------------
// Compiling

const mix = (a: string, percent: number, b: string) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;

/** Expands a palette into the full colour set for the given scheme. */
function derive(
	palette: Partial<Record<PaletteKey, string>>,
	scheme: ThemeScheme
): Partial<Record<ColorToken, string>> {
	const bg = palette.background!,
		fg = palette.foreground!,
		accent = palette.accent ?? fg;
	const dark = scheme === 'dark';
	const tone = (percent: number) => mix(fg, percent, bg);
	const derived: Partial<Record<ColorToken, string>> = {
		canvas: bg,
		surface: tone(3),
		field: tone(6),
		elevated: dark ? tone(8) : mix('var(--warm-white)', 45, bg),
		sheet: dark ? tone(3) : bg,
		card: dark ? tone(6) : bg,
		hover: tone(dark ? 7 : 6),
		active: tone(dark ? 10 : 8),
		pressed: tone(dark ? 14 : 11),
		selection: tone(dark ? 9 : 7),
		ink: fg,
		'muted-ink': tone(dark ? 82 : 88),
		secondary: tone(dark ? 68 : 75),
		tertiary: tone(dark ? 60 : 66),
		line: tone(dark ? 13 : 10),
		hairline: mix(fg, dark ? 7 : 5, 'transparent'),
		highlight: dark ? mix(fg, 4, 'transparent') : mix('var(--warm-white)', 40, 'transparent'),
		accent,
		'accent-hover': mix(accent, 85, fg),
		'on-accent': bg,
		scrim: mix(bg, dark ? 68 : 28, 'transparent'),
		'switch-off': tone(dark ? 22 : 16),
		'switch-knob': dark ? tone(70) : mix('var(--warm-white)', 70, bg),
		'switch-on': accent,
		'switch-on-knob': bg,
		'cover-glow': mix(accent, dark ? 30 : 14, 'transparent'),
		'cover-base': tone(dark ? 10 : 7)
	};
	if (!dark)
		Object.assign(derived, {
			'shadow-faint': mix(fg, 4, 'transparent'),
			'shadow-soft': mix(fg, 8, 'transparent'),
			'shadow-strong': mix(fg, 16, 'transparent')
		});
	if (palette.danger) derived.danger = palette.danger;
	if (palette.warning) derived.warning = palette.warning;
	return derived;
}

export type CompiledAppearance = {
	scheme: ThemeScheme;
	css: string;
	/** Plain colour for <meta name="theme-color">. */
	themeColor: string;
};

/**
 * Compiles a theme and its modules, in order: palette, explicit tokens, then each module.
 * Later layers win.
 */
export function compileAppearance(
	theme: BuiltinThemeId | ThemeDocument,
	modules: readonly ThemeDocument[] = []
): CompiledAppearance {
	const builtin = typeof theme === 'string' ? builtinTheme(theme) : undefined;
	const scheme: ThemeScheme =
		builtin?.scheme ?? (typeof theme === 'object' ? theme.scheme : undefined) ?? 'dark';
	const tokens = new Map<string, string>(),
		radii = new Map<string, string>();
	let themeColor: string = builtin?.swatch.canvas ?? (scheme === 'light' ? '#f7f5ef' : '#121212');
	for (const layer of typeof theme === 'object' ? [theme, ...modules] : modules) {
		const colorsOf = { ...(layer.palette ? derive(layer.palette, scheme) : {}), ...layer.colors };
		for (const [key, value] of Object.entries(colorsOf)) tokens.set(`--${key}`, value);
		const canvas = layer.colors?.canvas ?? layer.palette?.background;
		if (canvas && (HEX.test(canvas) || COLOR_FUNCTION.test(canvas))) themeColor = canvas;
		for (const [key, value] of Object.entries(layer.shape?.radius ?? {}))
			radii.set(`--radius-${key}`, `${value}px`);
		const type = layer.typography;
		for (const key of FONT_KEYS)
			if (type?.[key])
				tokens.set(
					`--font-${key}`,
					`${type[key]
						.split(', ')
						.map((family) => `'${family}'`)
						.join(', ')}, ${FONT_FALLBACKS[key]}`
				);
		if (type?.scale !== undefined)
			for (const [step, px] of Object.entries(TYPE_SCALE))
				tokens.set(`--text-${step}`, `${+(px * type.scale).toFixed(2)}px`);
	}
	const block = (selector: string, entries: Map<string, string>) =>
		entries.size
			? `${selector}{${[...entries].map(([name, value]) => `${name}:${value}`).join(';')}}`
			: '';
	// Outranks the built-in light palette; radii defer to square corners.
	const css =
		block(':root:root[data-theme]', tokens) +
		block(":root:root[data-theme]:not([data-corners='square'])", radii);
	return { scheme, css, themeColor };
}

/** Background, text and accent colours for previews. */
export function themeSwatch(theme: BuiltinThemeId | ThemeDocument) {
	if (typeof theme === 'string') return builtinTheme(theme)!.swatch;
	const zen = BUILTIN_THEMES.find((t) => t.scheme === theme.scheme)!.swatch;
	const derived = theme.palette ? derive(theme.palette, theme.scheme ?? 'dark') : {};
	const pick = (key: 'canvas' | 'ink' | 'accent') =>
		theme.colors?.[key] ?? derived[key] ?? zen[key];
	return { canvas: pick('canvas'), ink: pick('ink'), accent: pick('accent') };
}
