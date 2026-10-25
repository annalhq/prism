import { describe, expect, it } from 'vitest';
import { asset } from '$app/paths';
import { discoverFavicons, faviconSources, isBlankFavicon } from '../../src/lib/client/favicons.js';

const TWITTER_ICON = asset('site-icons/twitter.svg');
const YOUTUBE_ICON = asset('site-icons/youtube.svg');

describe('static site icons', () => {
	it.each([
		'https://x.com/user/status/1',
		'https://www.x.com/user',
		'https://twitter.com/user',
		'https://mobile.twitter.com/user'
	])('uses the bundled Twitter icon for %s', (url) => {
		expect(faviconSources(url)).toEqual([TWITTER_ICON]);
	});

	it.each([
		'https://youtube.com/watch?v=1',
		'https://www.youtube.com/watch?v=1',
		'https://m.youtube.com/watch?v=1',
		'https://music.youtube.com/watch?v=1',
		'https://youtu.be/1',
		'https://www.youtu.be/1'
	])('uses the bundled YouTube icon for %s', (url) => {
		expect(faviconSources(url)).toEqual([YOUTUBE_ICON]);
	});

	it('keeps remote fallbacks for other sites', () => {
		expect(faviconSources('https://example.com/article')).toEqual([
			'https://example.com/favicon.ico',
			'https://www.google.com/s2/favicons?domain=example.com&sz=64'
		]);
	});

	it('skips page discovery for known sites', async () => {
		await expect(discoverFavicons('https://x.com/user')).resolves.toEqual([TWITTER_ICON]);
		await expect(discoverFavicons('https://youtu.be/1')).resolves.toEqual([YOUTUBE_ICON]);
	});

	it('does not inspect bundled icons as blank', async () => {
		await expect(isBlankFavicon(TWITTER_ICON)).resolves.toBe(false);
		await expect(isBlankFavicon(YOUTUBE_ICON)).resolves.toBe(false);
	});
});
