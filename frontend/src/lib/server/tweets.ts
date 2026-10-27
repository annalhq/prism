import {
	getTweet,
	type MediaDetails,
	type QuotedTweet,
	type Tweet,
	type TweetBase
} from 'sveltweet/api';
import type {
	TweetAuthor,
	TweetCardData,
	TweetMediaItem,
	TweetSegment
} from '#lib/domain/tweet-card.js';

// Posts barely change once written; keep a bounded, process-local cache so a feed scroll
// doesn't refetch every post from the syndication API.
const TTL = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: Promise<TweetCardData | null> }>();

export function readTweetCard(id: string): Promise<TweetCardData | null> {
	const hit = cache.get(id);
	if (hit && Date.now() - hit.at < TTL) return hit.value;
	const value = getTweet(id, { signal: AbortSignal.timeout(8000) })
		.then((tweet) => (tweet ? toCard(tweet) : null))
		.catch((error) => {
			// Network failures are not cached; a missing post is (as null), briefly.
			cache.delete(id);
			throw error;
		});
	if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
	cache.set(id, { at: Date.now(), value });
	return value;
}

const safeHref = (value: string) => {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
};
const statusUrl = (tweet: TweetBase) =>
	`https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`;

function author(tweet: TweetBase): TweetAuthor {
	return {
		name: tweet.user.name,
		handle: tweet.user.screen_name,
		// `_normal` is 48px; `_bigger` (73px) stays sharp at 2× for a small avatar.
		avatar: tweet.user.profile_image_url_https.replace('_normal.', '_bigger.'),
		verified: tweet.user.verified || tweet.user.is_blue_verified
	};
}

type Range = { start: number; end: number; segment: Exclude<TweetSegment, { type: 'text' }> };
/**
 * The visible text split into plain runs and entities. Indices count code points, so the
 * text is walked as an array of code points, as react-tweet does. Trailing media links are
 * cut off by `display_text_range`, and t.co links show their expanded form.
 */
function segments(tweet: TweetBase): TweetSegment[] {
	// The syndication API leaves out entity lists that would be empty.
	const chars = Array.from(tweet.text);
	const start = tweet.display_text_range[0];
	let end = tweet.display_text_range[1];
	const media = tweet.entities?.media?.[0];
	if (media && media.indices[0] < end) end = media.indices[0];
	const ranges: Range[] = [];
	const add = (indices: [number, number], segment: Range['segment'] | null) => {
		if (segment && indices[0] >= start && indices[1] <= end)
			ranges.push({ start: indices[0], end: indices[1], segment });
	};
	const at = (indices: [number, number]) => chars.slice(indices[0], indices[1]).join('');
	for (const tag of tweet.entities?.hashtags ?? [])
		add(tag.indices, {
			type: 'hashtag',
			text: at(tag.indices),
			href: `https://x.com/hashtag/${encodeURIComponent(tag.text)}`
		});
	for (const mention of tweet.entities?.user_mentions ?? [])
		add(mention.indices, {
			type: 'mention',
			text: at(mention.indices),
			href: `https://x.com/${encodeURIComponent(mention.screen_name)}`
		});
	for (const symbol of tweet.entities?.symbols ?? [])
		add(symbol.indices, {
			type: 'symbol',
			text: at(symbol.indices),
			href: `https://x.com/search?q=%24${encodeURIComponent(symbol.text)}`
		});
	for (const link of tweet.entities?.urls ?? []) {
		const href = safeHref(link.expanded_url);
		add(link.indices, href ? { type: 'link', text: link.display_url, href } : null);
	}
	ranges.sort((a, b) => a.start - b.start);
	const out: TweetSegment[] = [];
	let cursor = start;
	for (const range of ranges) {
		if (range.start < cursor) continue;
		if (range.start > cursor)
			out.push({ type: 'text', text: chars.slice(cursor, range.start).join('') });
		out.push(range.segment);
		cursor = range.end;
	}
	if (cursor < end) out.push({ type: 'text', text: chars.slice(cursor, end).join('') });
	// The syndication API escapes these three in text; decode them once, as text nodes.
	return out.map((segment) =>
		segment.type === 'text'
			? {
					type: 'text',
					text: segment.text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
				}
			: segment
	);
}

function sized(url: string, name: 'small' | 'medium' | 'large') {
	const parsed = new URL(url);
	const extension = parsed.pathname.split('.').pop();
	if (!extension || extension === parsed.pathname) return url;
	parsed.pathname = parsed.pathname.replace(`.${extension}`, '');
	parsed.searchParams.set('format', extension);
	parsed.searchParams.set('name', name);
	return parsed.href;
}
function mediaItems(details: MediaDetails[] | undefined): TweetMediaItem[] {
	return (details ?? []).slice(0, 4).map((media) => {
		const mp4 =
			media.type === 'photo'
				? null
				: media.video_info.variants
						.filter((variant) => variant.content_type === 'video/mp4')
						.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
		return {
			kind: media.type === 'photo' ? 'photo' : media.type === 'video' ? 'video' : 'gif',
			image: sized(media.media_url_https, 'medium'),
			width: media.original_info.width,
			height: media.original_info.height,
			alt: media.type === 'photo' ? (media.ext_alt_text ?? '') : '',
			// Like react-tweet, skip the heaviest rendition when there is a lighter one.
			video: mp4?.length ? (mp4[1] ?? mp4[0]).url : null
		};
	});
}

export function toCard(tweet: Tweet): TweetCardData {
	const quoted: QuotedTweet | undefined = tweet.quoted_tweet;
	return {
		id: tweet.id_str,
		url: statusUrl(tweet),
		author: author(tweet),
		replyTo: tweet.in_reply_to_screen_name ?? null,
		segments: segments(tweet),
		media: mediaItems(tweet.mediaDetails),
		quoted: quoted
			? {
					url: statusUrl(quoted),
					author: author(quoted),
					segments: segments(quoted),
					media: mediaItems(quoted.mediaDetails)
				}
			: null
	};
}
