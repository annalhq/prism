import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse, safeErrorDetails } from '#lib/server/http.js';
import { MediaError } from '#lib/server/media/storage.js';
import { personAvatar } from '#lib/server/vault/person-avatars.js';
import { entityId } from '#lib/server/vault/read-parameters.js';

// A person's profile photo (from their X, GitHub, YouTube, Codeforces or Bilibili link), served
// from object storage. It is fetched from unavatar.io the first time it's asked for; until then,
// or while unavatar's daily limit is used up, this answers 404 and the client shows the monogram.
// The client puts the photo's source in the query string, so a changed link is a new URL;
// the browser keeps each URL's image without revalidating.
export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const image = await personAvatar(owner, entityId(event.params.id));
		// No photo (yet): say why, so it can be told apart from a failure in the network panel.
		if ('miss' in image)
			return new Response(null, {
				status: 404,
				headers: {
					'Cache-Control': 'no-store',
					'X-Prism-Avatar': image.miss,
					...(image.retryAt
						? { 'X-Prism-Avatar-Retry': new Date(image.retryAt).toISOString() }
						: {})
				}
			});
		const etag = `"${image.sha256}"`;
		const headers = {
			'Content-Type': image.mime,
			// The URL carries the photo's source, and a source's photo is stored once.
			'Cache-Control': 'private, max-age=31536000, immutable',
			ETag: etag,
			'Content-Security-Policy': "default-src 'none'; sandbox"
		};
		if (event.request.headers.get('if-none-match') === etag)
			return new Response(null, { status: 304, headers });
		return new Response(image.bytes as BodyInit, {
			headers: { ...headers, 'Content-Length': String(image.bytes.byteLength) }
		});
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		// A photo is decoration: any failure falls back to the monogram. The log says why:
		// database codes (42P01 means the person_avatars migration hasn't run), or the
		// storage/unavatar step and status, which never include secrets.
		console.error('prism.avatar.failed', {
			requestId: event.locals.requestId,
			...safeErrorDetails(error),
			...(error instanceof MediaError ? { detail: error.message } : {})
		});
		return new Response(null, {
			status: 404,
			headers: { 'Cache-Control': 'no-store', 'X-Prism-Avatar': 'error' }
		});
	}
};
