import { browser } from 'wxt/browser';

/**
 * Prism design tokens, shared by the in-page panel (shadow root) and the popup document. They
 * follow the web app: Libre Franklin for text, STK Bureau for titles, faint wells that lift into
 * a raised tab when active, and one soft ease for motion.
 */
export const themeCss = `
@font-face{font-family:"Libre Franklin";font-style:normal;font-weight:100 900;font-display:swap;src:url("${browser.runtime.getURL('/libre-franklin-latin-wght-normal.woff2')}") format("woff2")}
@font-face{font-family:"STK Bureau";font-style:normal;font-weight:400;font-display:swap;src:url("${browser.runtime.getURL('/stk-bureau-serif-book.woff2')}") format("woff2")}
:host,:root{
--canvas:#121212;--surface:#1a1a1a;--field:#202020;--elevated:#242424;
--ink:#efeeeb;--ink-2:#a3a29e;--ink-3:#7f7e7a;--line:#303030;--hairline:rgb(255 255 255 / 6%);
--highlight:rgb(255 255 255 / 4%);--shadow-soft:rgb(0 0 0 / 18%);--shadow-strong:rgb(0 0 0 / 36%);
--accent:#f5f5f7;--accent-ink:#161618;--danger:#f2a6a0;
--hover:rgb(255 255 255 / 5%);--ring:rgb(255 255 255 / 16%);
--raised:inset 0 0 0 1px var(--hairline),inset 0 1px 0 var(--highlight),0 1px 2px var(--shadow-soft);
--lift:color-mix(in srgb,var(--ink) 6%,var(--elevated));
--font:"Libre Franklin",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
--display:"STK Bureau","Iowan Old Style",Georgia,serif;
--mono:ui-monospace,SFMono-Regular,Menlo,monospace;
--ease:cubic-bezier(0.2,0.8,0.2,1);--spring:cubic-bezier(0.32,0.72,0,1);
--r-control:10px;--r-card:14px;--r-panel:20px;--r-pill:999px;
color-scheme:dark}
@media (prefers-color-scheme:light){:host,:root{
--canvas:#f7f7f4;--surface:#f2f1ed;--field:#ebeae5;--elevated:#fbfbf9;
--ink:#26251e;--ink-2:#26251e99;--ink-3:#26251e70;--line:#26251e1a;--hairline:#26251e0f;
--highlight:rgb(255 255 255 / 60%);--shadow-soft:rgb(38 37 30 / 8%);--shadow-strong:rgb(38 37 30 / 16%);
--accent:#26251e;--accent-ink:#f7f7f4;--danger:#cf2d56;
--hover:#26251e0a;--ring:#26251e29;
color-scheme:light}}
`;

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
	return letters.map((word) => [...word][0] ?? '').join('').toLocaleUpperCase() || '?';
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
	user: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 12),
	x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 10),
	check: svg('<path d="M20 6 9 17l-5-5"/>', 13),
	folderLarge: svg(`<path d="${folderPath}"/>`, 18)
};
