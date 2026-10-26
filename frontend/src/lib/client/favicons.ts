import { asset } from '$app/paths';

const MAX_PAGE_BYTES = 262_144;
const MAX_CACHED_PAGES = 256;
const TWITTER_ICON = asset('site-icons/twitter.svg');
const YOUTUBE_ICON = asset('site-icons/youtube.svg');
const siteIcons = new Set([TWITTER_ICON, YOUTUBE_ICON]);
const discoveries = new Map<string, Promise<string[]>>();
const blankIcons = new Map<string, Promise<boolean>>();
const waiting: (() => void)[] = [];
let running = 0;

// The icon that worked for each site, kept across reloads so a row can show it at once
// instead of rediscovering it. `null` remembers that a site has no usable icon.
const STORE_KEY = 'prism:favicons:v1';
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 1000;
type Remembered = { src: string | null; at: number };
let remembered: Map<string, Remembered> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function memory(): Map<string, Remembered> {
	if (remembered) return remembered;
	remembered = new Map();
	try {
		const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
		const now = Date.now();
		for (const [origin, value] of Object.entries(raw)) {
			const entry = value as Partial<Remembered>;
			if (typeof entry?.at !== 'number' || !(typeof entry.src === 'string' || entry.src === null))
				continue;
			if (now - entry.at < (entry.src ? FOUND_TTL_MS : MISSING_TTL_MS))
				remembered.set(origin, { src: entry.src, at: entry.at });
		}
	} catch {
		/* Storage may be unavailable or hold an old format. */
	}
	return remembered;
}

function persist() {
	clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(memory())));
		} catch {
			/* Optional cache. */
		}
	}, 500);
}

/** The icon last known to work for this page's site; null if it has none, undefined if unknown. */
export function rememberedFavicon(input: string | null): string | null | undefined {
	const url = pageUrl(input);
	if (!url || siteIcon(url.hostname) || typeof localStorage === 'undefined') return undefined;
	return memory().get(url.origin)?.src;
}

export function rememberFavicon(input: string | null, src: string | null): void {
	const url = pageUrl(input);
	if (!url || siteIcon(url.hostname) || typeof localStorage === 'undefined') return;
	const store = memory();
	if (store.get(url.origin)?.src === src) return;
	store.delete(url.origin);
	if (store.size >= MAX_REMEMBERED) store.delete(store.keys().next().value!);
	store.set(url.origin, { src, at: Date.now() });
	persist();
}

export function forgetFavicon(input: string | null): void {
	const url = pageUrl(input);
	if (url && memory().delete(url.origin)) persist();
}

function siteIcon(hostname: string): string | null {
	const host = hostname.toLowerCase().replace(/\.$/, '');
	if (
		host === 'x.com' ||
		host.endsWith('.x.com') ||
		host === 'twitter.com' ||
		host.endsWith('.twitter.com')
	)
		return TWITTER_ICON;
	if (
		host === 'youtube.com' ||
		host.endsWith('.youtube.com') ||
		host === 'youtu.be' ||
		host.endsWith('.youtu.be')
	)
		return YOUTUBE_ICON;
	return null;
}

function pageUrl(input: string | null): URL | null {
	try {
		const url = new URL(input ?? '');
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
		url.hash = '';
		return url;
	} catch {
		return null;
	}
}

export function faviconSources(input: string | null): string[] {
	const url = pageUrl(input);
	if (!url) return [];
	const icon = siteIcon(url.hostname);
	if (icon) return [icon];
	const sources = [`${url.origin}/favicon.ico`];
	const host = url.hostname;
	// Send only public hostnames to Google, never bookmark paths or query strings.
	if (
		host.includes('.') &&
		!host.includes(':') &&
		!/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
		!/\.(localhost|local|internal|lan|home|test)$/i.test(host)
	)
		sources.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`);
	return sources;
}

/** A successful image load can still be a completely transparent placeholder. */
export function isBlankFavicon(source: string): Promise<boolean> {
	// Bundled site icons are known to be visible; no canvas inspection needed.
	if (siteIcons.has(source)) return Promise.resolve(false);
	// Google already supplies a visible fallback; inspect only the site's own icons.
	if (source.startsWith('https://www.google.com/s2/favicons?')) return Promise.resolve(false);
	const existing = blankIcons.get(source);
	if (existing) return existing;
	const result = inspectFavicon(source);
	if (blankIcons.size >= MAX_CACHED_PAGES) blankIcons.delete(blankIcons.keys().next().value!);
	blankIcons.set(source, result);
	return result;
}

async function inspectFavicon(source: string): Promise<boolean> {
	let objectUrl: string | undefined;
	try {
		const response = await fetch(source, {
			mode: 'cors',
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			cache: 'force-cache',
			signal: AbortSignal.timeout(3_000)
		});
		if (!response.ok || !response.body) return false;
		const reader = response.body.getReader();
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		let bytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > MAX_PAGE_BYTES) return false;
				chunks.push(new Uint8Array(value));
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		const blob = new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
		objectUrl = URL.createObjectURL(blob);
		const image = new Image();
		image.src = objectUrl;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 32;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return false;
		context.drawImage(image, 0, 0, 32, 32);
		const pixels = context.getImageData(0, 0, 32, 32).data;
		for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return false;
		return true;
	} catch {
		// CORS can prohibit pixel inspection even when an <img> displays correctly.
		// Keep those images instead of imposing CORS on all favicon rendering.
		return false;
	} finally {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	}
}

async function readHead(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let html = '';
	let bytes = 0;
	try {
		while (bytes < MAX_PAGE_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			html += decoder.decode(value.subarray(0, MAX_PAGE_BYTES - bytes), { stream: true });
			bytes += value.byteLength;
			const end = html.search(/<\/head\s*>/i);
			if (end !== -1) return html.slice(0, end);
		}
		return html + decoder.decode();
	} finally {
		await reader.cancel().catch(() => {});
	}
}

async function discover(url: URL): Promise<string[]> {
	const fallback = faviconSources(url.href);
	try {
		const response = await fetch(url.href, {
			mode: 'cors',
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			signal: AbortSignal.timeout(5_000)
		});
		if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
			return fallback;
		// A detached template keeps scripts, styles, frames and images inert.
		const template = document.createElement('template');
		template.innerHTML = await readHead(response);
		const baseHref = template.content.querySelector('base[href]')?.getAttribute('href');
		const page = response.url || url.href;
		let base = page;
		try {
			if (baseHref) base = new URL(baseHref, page).href;
		} catch {
			/* Ignore a malformed base and resolve against the page. */
		}
		const icons: string[] = [];
		const touchIcons: string[] = [];
		for (const link of template.content.querySelectorAll('link[rel][href]')) {
			const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
			const target = rel.includes('icon')
				? icons
				: rel.some(
							(token) => token === 'apple-touch-icon' || token === 'apple-touch-icon-precomposed'
					  )
					? touchIcons
					: null;
			if (!target) continue;
			try {
				const icon = pageUrl(new URL(link.getAttribute('href')!, base).href);
				if (icon && (location.protocol !== 'https:' || icon.protocol === 'https:'))
					target.push(icon.href);
			} catch {
				/* Skip malformed icon declarations. */
			}
		}
		return [...new Set([...icons.slice(0, 8), ...touchIcons.slice(0, 4), ...fallback])];
	} catch {
		// CORS, offline and unreachable sites still get the static icon fallbacks.
		return fallback;
	}
}

/** Discover the page's own icons in the browser before falling back to root/Google icons. */
export function discoverFavicons(input: string | null): Promise<string[]> {
	const url = pageUrl(input);
	if (!url) return Promise.resolve([]);
	// Known sites use bundled icons; skip page HTML and remote favicon requests entirely.
	if (siteIcon(url.hostname)) return Promise.resolve(faviconSources(input));
	if (typeof document === 'undefined') return Promise.resolve(faviconSources(input));
	// Icons belong to a site, not a page: one discovery serves every bookmark on it.
	const existing = discoveries.get(url.origin);
	if (existing) return existing;
	const result = (async () => {
		// Bound background work when a library contains many different websites.
		if (running >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
		else running++;
		try {
			return await discover(url);
		} finally {
			const next = waiting.shift();
			if (next) next();
			else running--;
		}
	})();
	if (discoveries.size >= MAX_CACHED_PAGES) discoveries.delete(discoveries.keys().next().value!);
	discoveries.set(url.origin, result);
	void result.then((sources) => {
		// A temporary network/CORS failure must not become a permanent cache entry.
		const fallback = faviconSources(url.href);
		if (
			sources.every((source) => fallback.includes(source)) &&
			discoveries.get(url.origin) === result
		)
			discoveries.delete(url.origin);
	});
	return result;
}
