/// <reference lib="webworker" />
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `prism-shell-${version}`;
const assetUrls = new Set(
	[...immutable, ...assets].map(({ path }) => new URL(path, worker.location.origin).href)
);
const shellUrl = new URL('/', worker.location.origin).href;

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(cacheName);
			await cache.addAll([...assetUrls].map((url) => new Request(url, { credentials: 'omit' })));
			// Only this explicitly credential-free root shell is retained as HTML.
			// Authentication and vault data load separately through uncached API calls.
			try {
				const shell = await fetch(shellUrl, { credentials: 'omit', cache: 'no-store' });
				if (
					shell.ok &&
					!shell.redirected &&
					shell.headers.get('content-type')?.includes('text/html') &&
					!/private|no-store/i.test(shell.headers.get('cache-control') ?? '')
				)
					await cache.put(shellUrl, shell);
			} catch {
				// Static assets still install when the shell endpoint is unavailable.
			}
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys())
				if (
					(key.startsWith('prism-shell-') && key !== cacheName) ||
					key.startsWith('prism-favicons-')
				)
					await caches.delete(key);
		})()
	);
});

worker.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	// Let the HTTP cache handle remote images. Opaque responses hide HTTP status,
	// so retaining them in Cache Storage can make a failed icon persist indefinitely.
	if (
		request.method !== 'GET' ||
		url.origin !== worker.location.origin ||
		/^\/(?:api|auth)(?:\/|$)/.test(url.pathname)
	)
		return;
	if (assetUrls.has(url.href)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(cacheName);
				const cached = await cache.match(url.href);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) await cache.put(url.href, response.clone());
				return response;
			})()
		);
	} else if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					return await fetch(request);
				} catch (error) {
					const cached = await (await caches.open(cacheName)).match(shellUrl);
					if (cached) return cached;
					throw error;
				}
			})()
		);
	}
});
