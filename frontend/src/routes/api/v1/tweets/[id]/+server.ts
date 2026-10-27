import type { RequestHandler } from './$types';
import { ApiError } from '#lib/server/http.js';
import { readTweetCard } from '#lib/server/tweets.js';

// One post from X, shaped for the feed card. The owner-only API guard in hooks applies.
export const GET: RequestHandler = async ({ params }) => {
	if (!/^\d{1,25}$/.test(params.id))
		throw new ApiError(400, 'invalid_tweet', 'That is not a post ID.');
	let tweet;
	try {
		tweet = await readTweetCard(params.id);
	} catch {
		throw new ApiError(502, 'tweet_unavailable', 'X did not answer. Try again later.');
	}
	if (!tweet) throw new ApiError(404, 'tweet_not_found', 'This post was deleted or made private.');
	return Response.json(tweet, { headers: { 'Cache-Control': 'private, max-age=3600' } });
};
