import { asset } from '$app/paths';

const TWITTER_ICON = asset('site-icons/twitter.svg');
const YOUTUBE_ICON = asset('site-icons/youtube.svg');
const FALLBACK_DELAY_MS = 1_000;
const ATTEMPT_TIMEOUT_MS = 4_000;
// v2 stores provider URLs by hostname; old direct-site URLs and negative entries are ignored.
const STORE_KEY = 'prism:favicons:v2';
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 1000;
type Remembered = { src: string; at: number };
let remembered: Map<string, Remembered> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, Promise<string | null>>();

function memory(): Map<string, Remembered> {
	if (remembered) return remembered;
	remembered = new Map();
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
		if (!raw || typeof raw !== 'object') return remembered;
		for (const [host, value] of Object.entries(raw)) {
			if (!value || typeof value !== 'object') continue;
			const entry = value as Partial<Remembered>;
			if (
				typeof entry.at === 'number' &&
				typeof entry.src === 'string' &&
				Date.now() - entry.at >= 0 &&
				Date.now() - entry.at < FOUND_TTL_MS &&
				faviconSources(`https://${host}`).includes(entry.src)
			) {
				remembered.set(host, { src: entry.src, at: entry.at });
				if (remembered.size >= MAX_REMEMBERED) break;
			}
		}
	} catch {
		// Storage is optional, including in private browsing.
	}
	return remembered;
}

function persist() {
	clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(memory())));
		} catch {
			// The browser's HTTP image cache still works without localStorage.
		}
	}, 500);
}

function remember(host: string, src: string) {
	const store = memory();
	store.delete(host);
	if (store.size >= MAX_REMEMBERED) store.delete(store.keys().next().value!);
	store.set(host, { src, at: Date.now() });
	persist();
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

/** Only hostnames go to providers, never bookmark paths, ports or query strings. */
export function faviconSources(input: string | null): string[] {
	const url = pageUrl(input);
	if (!url) return [];
	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	const icon = siteIcon(host);
	if (icon) return [icon];
	if (
		!host.includes('.') ||
		host.includes(':') ||
		/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
		/\.(localhost|local|internal|lan|home|test)$/i.test(host)
	)
		return [];
	return [
		`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
		`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`
	];
}

/** Load through image elements so rendering never depends on CORS permission. */
function loadFirst(sources: string[], failed: (src: string) => void): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		let next = 0;
		const active = new Set<() => void>();
		let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
		function finish(src: string | null) {
			if (settled) return;
			settled = true;
			clearTimeout(fallbackTimer);
			for (const stop of active) stop();
			active.clear();
			resolve(src);
		}
		function startNext() {
			if (settled || next >= sources.length) return;
			const src = sources[next++];
			const image = new Image();
			let stopped = false;
			const timer = setTimeout(fail, ATTEMPT_TIMEOUT_MS);
			function stop() {
				stopped = true;
				clearTimeout(timer);
				image.onload = image.onerror = null;
				image.removeAttribute('src');
				active.delete(stop);
			}
			function fail() {
				if (settled || stopped) return;
				stop();
				failed(src);
				clearTimeout(fallbackTimer);
				startNext();
				if (!active.size) finish(null);
			}
			active.add(stop);
			image.onload = () => {
				if (!stopped) finish(src);
			};
			image.onerror = fail;
			image.referrerPolicy = 'no-referrer';
			image.src = src;
		}
		startNext();
		if (sources.length > 1 && !settled) fallbackTimer = setTimeout(startNext, FALLBACK_DELAY_MS);
	});
}

/** Share bounded work across rows; failed attempts are never cached as missing icons. */
export function resolveFavicon(input: string | null): Promise<string | null> {
	const sources = faviconSources(input);
	if (!sources.length || typeof Image === 'undefined') return Promise.resolve(null);
	const host = pageUrl(input)!.hostname.toLowerCase().replace(/\.$/, '');
	const existing = pending.get(host);
	if (existing) return existing;
	const store = memory();
	const known = store.get(host);
	if (known && Date.now() - known.at >= FOUND_TTL_MS) store.delete(host);
	const preferred = store.get(host)?.src;
	if (preferred && sources.includes(preferred))
		sources.sort((a, b) => Number(b === preferred) - Number(a === preferred));
	const result = loadFirst(sources, (src) => {
		if (store.get(host)?.src === src) {
			store.delete(host);
			persist();
		}
	})
		.then((src) => {
			if (src && sources.length > 1) remember(host, src);
			return src;
		})
		.finally(() => {
			pending.delete(host);
		});
	pending.set(host, result);
	return result;
}
