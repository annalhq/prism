// Isolated browser harness: no app auth, database, test route, or real provider calls.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const harnessId = `${root}favicon-test-harness.svelte`;
const svg =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>';
const server = await createServer({
	root,
	envDir: false,
	server: { host: '127.0.0.1', port: 5189, strictPort: true },
	plugins: [
		{
			name: 'favicon-regression-harness',
			resolveId(id) {
				if (id === '/favicon-test-harness.svelte') return harnessId;
				if (id === '/favicon-test-boot.js') return `${root}favicon-test-boot.js`;
			},
			load(id) {
				if (id === `${root}favicon-test-boot.js`)
					return `import {mount} from 'svelte'; import Harness from '/favicon-test-harness.svelte'; mount(Harness,{target:document.querySelector('#test')});`;
				if (id !== harnessId) return;
				return `<script>
    import { flushSync } from 'svelte';
    import Favicon from '/src/lib/components/ui/Favicon.svelte';
    let url = $state('https://example.com');
    let shown = $state(true);
    window.faviconHarness = {
     setUrl(next) { flushSync(() => { url = next; }); },
     destroy() { flushSync(() => { shown = false; }); }
    };
   </script>{#if shown}<Favicon {url} />{/if}`;
			},
			configureServer(vite) {
				vite.middlewares.use('/__favicon-test', (_req, res) => {
					res.setHeader('Content-Type', 'text/html');
					res.end(
						'<div id="test"></div><script type="module">import "/favicon-test-boot.js";</script>'
					);
				});
			}
		}
	]
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
	});
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 }
	]) {
		for (const scenario of [
			'stalled primary',
			'both fail',
			'URL changes',
			'unmount',
			'stale image event'
		]) {
			const page = await browser.newPage({ viewport });
			/** @type {string[]} */
			const errors = [];
			/** @type {string[]} */
			const requests = [];
			/** @type {(() => void)[]} */
			const held = [];
			let releasePlaceholder = () => {};
			const placeholderReady = new Promise((resolve) => {
				releasePlaceholder = () => resolve(undefined);
			});
			let primaryRequested = () => {};
			const primaryStarted = new Promise((resolve) => {
				primaryRequested = () => resolve(undefined);
			});
			page.on('pageerror', (error) => errors.push(error.message));
			await page.route('https://**/*', async (route) => {
				const url = route.request().url();
				requests.push(url);
				await placeholderReady;
				assert.match(new URL(url).hostname, /^(www\.google\.com|icons\.duckduckgo\.com)$/);
				assert.equal(route.request().resourceType(), 'image');
				if (scenario === 'both fail') return route.abort();
				if (url.includes('google.com') && url.includes('example.com') && held.length === 0)
					await new Promise((resolve) => {
						held.push(() => resolve(undefined));
						primaryRequested();
					});
				await route.fulfill({ contentType: 'image/svg+xml', body: svg }).catch(() => {});
			});
			await page.goto('http://127.0.0.1:5189/__favicon-test', { waitUntil: 'domcontentloaded' });
			await page.waitForSelector('.favicon svg');
			releasePlaceholder();
			if (scenario === 'stale image event') {
				await primaryStarted;
				for (const release of held) release();
			}
			if (scenario === 'URL changes')
				await page.evaluate(() =>
					Reflect.get(window, 'faviconHarness').setUrl('https://stripe.com')
				);
			if (scenario === 'unmount')
				await page.evaluate(() => Reflect.get(window, 'faviconHarness').destroy());
			if (scenario === 'both fail') {
				await page.waitForTimeout(100);
				assert.equal(await page.locator('.favicon img').count(), 0);
				assert.equal(await page.locator('.favicon.fallback svg').count(), 1);
			} else if (scenario === 'unmount') {
				assert.equal(await page.locator('.favicon').count(), 0);
			} else {
				await page.waitForFunction(() => {
					const image = document.querySelector('img');
					return (
						image?.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1'
					);
				});
				const src = await page.locator('.favicon img').getAttribute('src');
				assert.match(
					src ?? '',
					scenario === 'URL changes'
						? /domain=stripe.com/
						: scenario === 'stale image event'
							? /domain=example.com/
							: /icons.duckduckgo.com/
				);
				for (const release of held) release();
				await page.waitForTimeout(100);
				assert.equal(await page.locator('.favicon img').getAttribute('src'), src);
				assert.equal(await page.locator('.favicon svg').count(), 0);
			}

			if (scenario === 'stale image event') {
				await page.evaluate(() => {
					Reflect.set(window, 'oldFavicon', document.querySelector('.favicon img'));
					Reflect.get(window, 'faviconHarness').setUrl('https://stripe.com');
				});
				await page.waitForFunction(
					() =>
						document.querySelector('img')?.src.includes('stripe.com') &&
						!document.querySelector('.favicon.fallback')
				);
				await page.evaluate(() =>
					Reflect.get(window, 'oldFavicon').dispatchEvent(new Event('error'))
				);
				await page.waitForTimeout(100);
				assert.match(
					(await page.locator('.favicon img').getAttribute('src')) ?? '',
					/domain=stripe.com/
				);
			}
			for (const release of held) release();
			assert.deepEqual(errors, []);
			assert.ok(requests.length > 0);
			await page.close();
			console.log(`PASS ${viewport.width}px: ${scenario}`);
		}
	}
} finally {
	await browser?.close();
	await server.close();
}
