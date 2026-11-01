import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { personAvatar } from '#lib/server/vault/person-avatars.js';
import { entityId } from '#lib/server/vault/read-parameters.js';

// A person's X profile photo, from object storage. It is fetched from unavatar.io the first time
// it's asked for; until then, or while unavatar's daily limit is used up, this answers 404 and
// the client shows the monogram. The client puts the person's handle in the query string, so a
// changed handle is a new URL; otherwise the browser may keep the image for a week.
export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const image = await personAvatar(owner, entityId(event.params.id));
		if (!image)
			return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
		const etag = `"${image.sha256}"`;
		const headers = {
			'Content-Type': image.mime,
			'Cache-Control': 'private, max-age=604800',
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
		// A photo is decoration: any failure falls back to the monogram without noise.
		console.error('prism.avatar.failed', { requestId: event.locals.requestId });
		return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
	}
};
