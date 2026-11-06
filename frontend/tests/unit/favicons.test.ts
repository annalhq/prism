import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asset } from '$app/paths';

const google = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
const duck = (host: string) => `https://icons.duckduckgo.com/ip3/${host}.ico`;

// Image events and storage are browser boundaries; the resolver and timers are real.
class TestImage {
	static instances: TestImage[] = [];
	src = '';
	referrerPolicy = '';
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() {
		TestImage.instances.push(this);
	}
	removeAttribute() {
		this.src = '';
	}
}

let favicons: typeof import('../../src/lib/client/favicons.js');
let storage: Map<string, string>;
beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	TestImage.instances = [];
	storage = new Map();
	vi.stubGlobal('Image', TestImage);
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value)
	});
	favicons = await import('../../src/lib/client/favicons.js');
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('favicon providers', () => {
	it.each(['https://x.com/user', 'https://mobile.twitter.com/user'])(
		'bundles Twitter: %s',
		(url) => {
			expect(favicons.faviconSources(url)).toEqual([asset('site-icons/twitter.svg')]);
		}
	);
	it.each(['https://youtu.be/1', 'https://music.youtube.com/watch?v=1'])(
		'bundles YouTube: %s',
		(url) => {
			expect(favicons.faviconSources(url)).toEqual([asset('site-icons/youtube.svg')]);
		}
	);
	it('uses hostname-only Google then DuckDuckGo URLs', () => {
		expect(favicons.faviconSources('https://stripe.com:8443/private?q=secret')).toEqual([
			google('stripe.com'),
			duck('stripe.com')
		]);
	});
	it.each([
		null,
		'bad',
		'file:///tmp/file',
		'https://user:pass@example.com',
		'http://localhost:5173',
		'http://127.0.0.1',
		'http://[::1]',
		'http://host.internal',
		'http://host.local',
		'http://host.test',
		'http://intranet'
	])('does not send private/invalid inputs to providers: %s', (url) => {
		expect(favicons.faviconSources(url)).toEqual([]);
	});
});

describe('favicon resolution', () => {
	it('starts Google immediately and avoids fallback after success', async () => {
		const result = favicons.resolveFavicon('https://example.com/a');
		expect(TestImage.instances.map((i) => i.src)).toEqual([google('example.com')]);
		TestImage.instances[0].onload!();
		await expect(result).resolves.toBe(google('example.com'));
		await vi.advanceTimersByTimeAsync(5000);
		expect(TestImage.instances).toHaveLength(1);
	});
	it('starts DuckDuckGo at one second and ignores a late Google success', async () => {
		const result = favicons.resolveFavicon('https://example.com');
		const lateLoad = TestImage.instances[0].onload!;
		await vi.advanceTimersByTimeAsync(999);
		expect(TestImage.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(TestImage.instances[1].src).toBe(duck('example.com'));
		TestImage.instances[1].onload!();
		await expect(result).resolves.toBe(duck('example.com'));
		lateLoad();
		await vi.advanceTimersByTimeAsync(500);
		expect([...storage.values()].join('')).toContain(duck('example.com'));
	});
	it('starts fallback immediately on primary failure', async () => {
		const result = favicons.resolveFavicon('https://example.com');
		TestImage.instances[0].onerror!();
		expect(TestImage.instances[1].src).toBe(duck('example.com'));
		TestImage.instances[1].onload!();
		await expect(result).resolves.toBe(duck('example.com'));
	});
	it('bounds stalled attempts and retries transient failures on next visit', async () => {
		const result = favicons.resolveFavicon('https://example.com');
		await vi.advanceTimersByTimeAsync(5000);
		await expect(result).resolves.toBeNull();
		expect(TestImage.instances.every((i) => i.onload === null && i.onerror === null)).toBe(true);
		const retry = favicons.resolveFavicon('https://example.com');
		expect(TestImage.instances[2].src).toBe(google('example.com'));
		TestImage.instances[2].onload!();
		await retry;
	});
	it('shares concurrent work across paths, schemes and ports on one hostname', async () => {
		const first = favicons.resolveFavicon('https://example.com/a');
		const second = favicons.resolveFavicon('http://example.com:8080/b');
		expect(TestImage.instances).toHaveLength(1);
		TestImage.instances[0].onload!();
		expect(await first).toBe(await second);
	});
	it('persists the successful fallback and recovers when that provider later fails', async () => {
		const first = favicons.resolveFavicon('https://example.com');
		TestImage.instances[0].onerror!();
		TestImage.instances[1].onload!();
		await first;
		await vi.advanceTimersByTimeAsync(500);
		vi.resetModules();
		favicons = await import('../../src/lib/client/favicons.js');
		const next = favicons.resolveFavicon('https://example.com/another');
		expect(TestImage.instances[2].src).toBe(duck('example.com'));
		TestImage.instances[2].onerror!();
		expect(TestImage.instances[3].src).toBe(google('example.com'));
		TestImage.instances[3].onload!();
		await expect(next).resolves.toBe(google('example.com'));
	});
	it('works when storage is unavailable', async () => {
		vi.stubGlobal('localStorage', {
			getItem() {
				throw Error('blocked');
			},
			setItem() {
				throw Error('blocked');
			}
		});
		const result = favicons.resolveFavicon('https://example.com');
		TestImage.instances[0].onload!();
		await expect(result).resolves.toBe(google('example.com'));
		await vi.advanceTimersByTimeAsync(500);
	});
});
