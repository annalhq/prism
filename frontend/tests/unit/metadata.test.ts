import { describe, expect, it } from 'vitest';
import {
	decodeHtmlEntities,
	extractPageTitle,
	isBlockedAddress
} from '../../src/lib/server/metadata.js';

describe('page title extraction', () => {
	it('prefers Open Graph titles and decodes entities', () => {
		const html =
			'<html><head><meta property="og:title" content="Prism &amp; friends"><title>Fallback</title></head></html>';
		expect(extractPageTitle(html)).toBe('Prism & friends');
	});

	it('falls back to twitter:title, title and h1 in order', () => {
		expect(
			extractPageTitle(
				'<meta name="twitter:title" content="Twitter title"><title>Title tag</title>'
			)
		).toBe('Twitter title');
		expect(extractPageTitle('<title>Title tag</title><h1>Heading</h1>')).toBe('Title tag');
		expect(extractPageTitle('<h1>Heading &mdash; here</h1>')).toBe('Heading — here');
	});

	it('handles reordered attributes, quotes and inline markup', () => {
		expect(extractPageTitle("<meta content='Ordered title' property='og:title'>")).toBe(
			'Ordered title'
		);
		expect(extractPageTitle('<title>  Hello &amp; <b>world</b>  </title>')).toBe('Hello & world');
	});

	it('returns an empty title when the page has none', () => {
		expect(extractPageTitle('<p>No heading here</p>')).toBe('');
	});

	it('decodes numeric entities and leaves unknown entities intact', () => {
		expect(decodeHtmlEntities('&#65;&#x42; &unknown;')).toBe('AB &unknown;');
	});
});

describe('metadata address guard', () => {
	it.each([
		'127.0.0.1',
		'10.0.0.1',
		'172.16.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'0.0.0.0',
		'224.0.0.1',
		'::1',
		'::',
		'fc00::1',
		'fe80::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'2001:db8::1'
	])('blocks %s', (address) => {
		expect(isBlockedAddress(address)).toBe(true);
	});

	it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
		'allows %s',
		(address) => {
			expect(isBlockedAddress(address)).toBe(false);
		}
	);
});
