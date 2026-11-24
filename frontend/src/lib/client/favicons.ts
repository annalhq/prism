import { FaviconCache } from './favicon-cache.js';
import { faviconHost, sourcesFor, type FaviconSource } from './favicon-providers.js';

// The next source starts after this even if the current one is still loading.
const FALLBACK_DELAY_MS = 1_000;
const ATTEMPT_TIMEOUT_MS = 4_000;

const cache = new FaviconCache((host, src) => sourcesFor(host).some((s) => s.src === src));
const pending = new Map<string, Promise<string | null>>();

/** Icon URLs tried for a page, in order; empty for private or invalid URLs. */
export function faviconSources(input: string | null): string[] {
	const host = faviconHost(input);
	return host ? sourcesFor(host).map((source) => source.src) : [];
}

/**
 * Resolves the first source that loads a real icon. Concurrent calls for one hostname share the
 * work, and the winner is tried first on later visits.
 */
export function resolveFavicon(input: string | null): Promise<string | null> {
	const host = faviconHost(input);
	if (!host || typeof Image === 'undefined') return Promise.resolve(null);
	const existing = pending.get(host);
	if (existing) return existing;
	const sources = sourcesFor(host);
	if (!sources.length) return Promise.resolve(null);

	const preferred = cache.get(host);
	if (preferred) sources.sort((a, b) => Number(b.src === preferred) - Number(a.src === preferred));

	const result = loadFirst(sources, (src) => cache.forget(host, src))
		.then((src) => {
			if (src && sources.length > 1) cache.set(host, src);
			return src;
		})
		.finally(() => pending.delete(host));
	pending.set(host, result);
	return result;
}

/**
 * Loads through image elements, so it never depends on CORS. Sources race with a staggered
 * start: a failure starts the next one at once, a slow load starts it after a short delay.
 */
function loadFirst(
	sources: FaviconSource[],
	onFailure: (src: string) => void
): Promise<string | null> {
	return new Promise((resolve) => {
		const active = new Set<() => void>();
		let next = 0;
		let settled = false;
		let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

		const finish = (src: string | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(fallbackTimer);
			for (const stop of active) stop();
			resolve(src);
		};

		const start = () => {
			if (settled || next >= sources.length) return;
			const source = sources[next++];
			const image = new Image();
			const timer = setTimeout(() => fail(), ATTEMPT_TIMEOUT_MS);
			const stop = () => {
				clearTimeout(timer);
				image.onload = image.onerror = null;
				image.removeAttribute('src');
				active.delete(stop);
			};
			const fail = () => {
				if (settled || !active.has(stop)) return;
				stop();
				onFailure(source.src);
				clearTimeout(fallbackTimer);
				start();
				if (!active.size) finish(null);
			};
			active.add(stop);
			image.onload = () => {
				if (!active.has(stop)) return;
				if (source.accepts(image)) finish(source.src);
				else fail();
			};
			image.onerror = fail;
			image.referrerPolicy = 'no-referrer';
			image.src = source.src;
		};

		start();
		if (sources.length > 1 && !settled) fallbackTimer = setTimeout(start, FALLBACK_DELAY_MS);
	});
}
