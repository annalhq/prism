import { describe, expect, it } from 'vitest';
import type { Tweet } from 'sveltweet/api';
import { tweetStatusId } from '../../src/lib/domain/tweets.js';
import { toCard } from '../../src/lib/server/tweets.js';

describe('tweet links', () => {
	it('finds the status ID of a single post', () => {
		expect(tweetStatusId('https://x.com/jack/status/20')).toBe('20');
		expect(tweetStatusId('https://twitter.com/jack/status/20?s=46')).toBe('20');
		expect(tweetStatusId('https://mobile.twitter.com/jack/statuses/20/photo/1')).toBe('20');
		expect(tweetStatusId('https://x.com/i/web/status/1849')).toBe('1849');
	});

	it('ignores profiles, other sites and look-alikes', () => {
		expect(tweetStatusId('https://x.com/jack')).toBeNull();
		expect(tweetStatusId('https://x.com/search?q=status/20')).toBeNull();
		expect(tweetStatusId('https://notx.com/jack/status/20')).toBeNull();
		expect(tweetStatusId('not a url')).toBeNull();
	});
});

describe('tweet card', () => {
	const user = {
		id_str: '1',
		name: 'Ada',
		screen_name: 'ada',
		profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
		profile_image_shape: 'Circle',
		verified: false,
		is_blue_verified: true
	} as const;
	const tweet = {
		id_str: '99',
		// Emoji count as one code point in the indices, as the API reports them.
		text: '🚀 hi @bob see https://t.co/x #ship &amp; more https://t.co/m',
		display_text_range: [0, 46],
		entities: {
			hashtags: [{ indices: [29, 34], text: 'ship' }],
			user_mentions: [{ indices: [5, 9], screen_name: 'bob', name: 'Bob', id_str: '2' }],
			urls: [
				{
					indices: [14, 28],
					url: 'https://t.co/x',
					display_url: 'example.com/a',
					expanded_url: 'https://example.com/a'
				}
			],
			symbols: [],
			media: [
				{
					indices: [46, 60],
					url: 'https://t.co/m',
					display_url: 'pic.x.com/m',
					expanded_url: 'https://x.com/ada/status/99/photo/1'
				}
			]
		},
		user,
		mediaDetails: [
			{
				type: 'photo',
				media_url_https: 'https://pbs.twimg.com/media/abc.jpg',
				original_info: { width: 1200, height: 800 }
			}
		]
	} as unknown as Tweet;

	it('splits text into entities and drops the trailing media link', () => {
		const card = toCard(tweet);
		expect(card.url).toBe('https://x.com/ada/status/99');
		expect(card.author).toMatchObject({ handle: 'ada', verified: true });
		expect(card.author.avatar).toContain('_bigger.');
		expect(card.segments).toEqual([
			{ type: 'text', text: '🚀 hi ' },
			{ type: 'mention', text: '@bob', href: 'https://x.com/bob' },
			{ type: 'text', text: ' see ' },
			{ type: 'link', text: 'example.com/a', href: 'https://example.com/a' },
			{ type: 'text', text: ' ' },
			{ type: 'hashtag', text: '#ship', href: 'https://x.com/hashtag/ship' },
			{ type: 'text', text: ' & more ' }
		]);
		expect(card.media[0]).toMatchObject({
			kind: 'photo',
			image: 'https://pbs.twimg.com/media/abc?format=jpg&name=medium',
			video: null
		});
	});
});
