import { browser } from 'wxt/browser';

/** Where the extension keeps its cached catalog (with the synced appearance) and settings. */
export const catalogKey = 'prismCatalog';
export const cornersKey = 'prismCorners';

/** The library's theme, resolved on the server to the CSS variables it changes. */
export type Appearance = { scheme: 'dark' | 'light'; tokens: Record<string, string> };

// Zen dark and Zen light, copied from the web app's app.css. Synced themes layer over these.
const zenDark = `--canvas:#121212;--surface:#1a1a1a;--field:#202020;--elevated:#242424;--sheet:#1b1b1b;--card:#202020;
--hover:#252525;--active:#2b2b2b;--pressed:#333333;--selection:#292929;
--ink:#efeeeb;--muted-ink:#c4c2ba;--secondary:#a3a29e;--tertiary:#92918d;--line:#303030;
--hairline:rgb(255 255 255 / 6%);--highlight:rgb(255 255 255 / 4%);
--accent:#f4f2ec;--accent-hover:#faf8f3;--on-accent:#161618;--danger:#f2a6a0;--warning:#d5b47a;
--shadow-faint:rgb(0 0 0 / 8%);--shadow-soft:rgb(0 0 0 / 18%);--shadow-strong:rgb(0 0 0 / 36%);
--switch-off:#444444;--switch-knob:#bbbbbb;--switch-on:#d2d1c8;--switch-on-knob:#353535;
color-scheme:dark`;
const zenLight = `--canvas:#f7f5ef;--surface:#f2f0e9;--field:#ebe8e0;--elevated:#faf7ef;--sheet:#f7f5ef;--card:#f7f5ef;
--hover:#ebe8e0;--active:#e6e3da;--pressed:#e0ddd3;--selection:#e7e4db;
--ink:#26251e;--muted-ink:#3b3a33e0;--secondary:#26251ec0;--tertiary:#26251ea8;--line:#26251e1a;
--hairline:#26251e0d;--highlight:color-mix(in srgb,var(--warm-white) 40%,transparent);
--accent:#26251e;--accent-hover:#3b3a33;--on-accent:#f7f5ef;--danger:#cf2d56;--warning:#a8641f;
--shadow-faint:rgb(38 37 30 / 4%);--shadow-soft:rgb(38 37 30 / 8%);--shadow-strong:rgb(38 37 30 / 16%);
--switch-off:#d9d5cb;--switch-knob:#faf7ef;--switch-on:#26251e;--switch-on-knob:#f7f5ef;
color-scheme:light`;

/**
 * Prism design tokens, shared by the in-page panel (shadow root) and the popup document. Names
 * and values follow the web app, so a synced theme's variables apply as they are: STK Bureau
 * Sans for text, its Semi Mono for data, faint wells that lift into a raised tab when active,
 * and one soft ease for motion. Before a theme has synced, the system colour scheme picks Zen
 * dark or light.
 */
export const themeCss = `
@font-face{font-family:"STK Bureau Sans";font-style:normal;font-weight:400;font-display:swap;src:url("${browser.runtime.getURL('/stk-bureau-sans-book.woff2')}") format("woff2")}
@font-face{font-family:"STK Bureau Sans";font-style:normal;font-weight:500;font-display:swap;src:url("${browser.runtime.getURL('/stk-bureau-sans-medium.woff2')}") format("woff2")}
@font-face{font-family:"STK Bureau Sans Semi Mono";font-style:normal;font-weight:400;font-display:swap;src:url("${browser.runtime.getURL('/stk-bureau-sans-semimono-regular.woff2')}") format("woff2")}
:host,:root{
${zenDark};
--warm-white:#fffaf2;
--raised:inset 0 0 0 1px var(--hairline),inset 0 1px 0 var(--highlight),0 1px 2px var(--shadow-soft);
--lift:color-mix(in srgb,var(--ink) 6%,var(--elevated));
--ring:color-mix(in srgb,var(--ink) 16%,transparent);
--font-sans:"STK Bureau Sans",system-ui,sans-serif;
--font-mono:"STK Bureau Sans Semi Mono",ui-monospace,"SF Mono",Menlo,monospace;
--text-xs:11px;--text-sm:12px;--text-md:13px;--text-base:14px;--text-body:15px;--text-lg:16px;--text-xl:20px;--text-title:22px;
--tracking-title:-0.01em;
--ease-out:cubic-bezier(0.2,0.8,0.2,1);--ease-spring:cubic-bezier(0.32,0.72,0,1);
--radius-sm:6px;--radius-control:10px;--radius-card:14px;--radius-panel:18px;--radius-pill:999px}
@media (prefers-color-scheme:light){:host(:not([data-scheme])),:root:not([data-scheme]){${zenLight}}}
:host([data-scheme=light]),:root[data-scheme=light]{${zenLight}}
:host([data-corners=square]),:root[data-corners=square]{--radius-sm:0px!important;--radius-control:0px!important;--radius-card:0px!important;--radius-panel:0px!important;--radius-pill:0px!important}
:host([data-corners=square]) *,:root[data-corners=square] *,:host([data-corners=square]) *::before,:root[data-corners=square] *::before,:host([data-corners=square]) *::after,:root[data-corners=square] *::after{border-radius:0!important}
`;

/**
 * A synced theme's variables as one rule. The server validated them, but they come over the
 * network into pages, so only plain variable names and values without CSS syntax pass.
 */
function appearanceCss(appearance: Appearance): string {
	const declarations = Object.entries(appearance.tokens ?? {}).flatMap(([name, value]) =>
		/^--[a-z0-9-]{1,40}$/.test(name) &&
		typeof value === 'string' &&
		value.length <= 200 &&
		!/[;{}<>\\]/.test(value)
			? [`${name}:${value}`]
			: []
	);
	// Same specificity as the light base above, and later, so the theme wins.
	return declarations.length
		? `:host([data-scheme]),:root[data-scheme]{${declarations.join(';')}}`
		: '';
}

/** Puts the synced theme and this device's corner style on a shadow root or the popup. */
export function applyLook(
	root: ShadowRoot | Document,
	look: { appearance?: Appearance; corners?: boolean }
) {
	const element = root instanceof Document ? root.documentElement : (root.host as HTMLElement);
	const parent = root instanceof Document ? root.head : root;
	if (look.appearance)
		element.dataset.scheme = look.appearance.scheme === 'light' ? 'light' : 'dark';
	else delete element.dataset.scheme;
	if (look.corners) element.dataset.corners = 'square';
	else delete element.dataset.corners;
	let style = parent.querySelector<HTMLStyleElement>('style[data-prism-appearance]');
	if (!style) {
		style = document.createElement('style');
		style.dataset.prismAppearance = '';
		parent.append(style);
	}
	style.textContent = look.appearance ? appearanceCss(look.appearance) : '';
}

async function readLook() {
	const stored = await browser.storage.local.get([catalogKey, cornersKey]);
	const cache = stored[catalogKey] as { catalog?: { appearance?: Appearance } } | undefined;
	return { appearance: cache?.catalog?.appearance, corners: stored[cornersKey] === true };
}

/** The scheme in use: the synced theme's, or the system's before one has synced. */
export async function currentScheme(): Promise<'dark' | 'light'> {
	const { appearance } = await readLook();
	return (
		appearance?.scheme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
	);
}

/**
 * Applies the stored look now and again whenever the catalog refreshes or settings change, so
 * an open popup or panel follows a theme switched in Prism. Returns a function that stops it.
 */
export function followLook(root: ShadowRoot | Document): () => void {
	let stopped = false;
	const apply = () =>
		void readLook()
			.then((look) => !stopped && applyLook(root, look))
			.catch(() => {});
	const onChanged = (changes: Record<string, unknown>, area: string) => {
		if (area === 'local' && (catalogKey in changes || cornersKey in changes)) apply();
	};
	apply();
	browser.storage.onChanged.addListener(onChanged);
	return () => {
		stopped = true;
		browser.storage.onChanged.removeListener(onChanged);
	};
}

/** A person's monogram colour, the same hue the web app derives from their name. */
export function avatarHue(name: string): number {
	let hash = 0;
	for (const char of name.trim().toLocaleLowerCase())
		hash = (Math.imul(hash, 31) + char.codePointAt(0)!) | 0;
	return Math.abs(hash) % 360;
}
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
	return (
		letters
			.map((word) => [...word][0] ?? '')
			.join('')
			.toLocaleUpperCase() || '?'
	);
}

const svg = (body: string, size = 14) =>
	`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const folderPath =
	'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z';

export const bookmarkPath = 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z';

/** Lucide icons, inlined (static markup only). */
export const icons = {
	folder: svg(`<path d="${folderPath}"/>`),
	hash: svg(
		'<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
		12
	),
	user: svg(
		'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
		12
	),
	x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 10),
	check: svg('<path d="M20 6 9 17l-5-5"/>', 13),
	enter: svg('<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>', 11),
	folderLarge: svg(`<path d="${folderPath}"/>`, 18),
	settings: svg(
		'<path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.92 2.34 2.34 0 0 1 2.33 4.03 2.34 2.34 0 0 0 0 3.83 2.34 2.34 0 0 1-2.33 4.03 2.34 2.34 0 0 0-3.32 1.92 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.92 2.34 2.34 0 0 1-2.33-4.03 2.34 2.34 0 0 0 0-3.83 2.34 2.34 0 0 1 2.33-4.03A2.34 2.34 0 0 0 9.67 4.14"/><circle cx="12" cy="12" r="3"/>',
		13
	),
	back: svg('<path d="m15 18-6-6 6-6"/>', 14),
	plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>', 11),
	highlight: svg(
		'<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
		12
	)
};
