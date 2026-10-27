const TWEET_HOSTS = new Set([
	'x.com',
	'twitter.com',
	'mobile.x.com',
	'mobile.twitter.com',
	'www.x.com',
	'www.twitter.com'
]);
/** The name of the tag every saved post from X is filed under. */
export const TWEETS_TAG = 'tweets';
/**
 * The status ID of a link to a single post on X, such as x.com/jack/status/20 or
 * twitter.com/i/web/status/20. Profiles, searches and other pages are not posts.
 */
export function tweetStatusId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (!TWEET_HOSTS.has(url.hostname.toLowerCase().replace(/\.$/, ''))) return null;
	const match = /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(
		url.pathname
	);
	return match ? match[1] : null;
}
