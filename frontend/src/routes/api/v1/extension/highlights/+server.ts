import type { RequestHandler } from './$types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireExtensionOwner } from '#lib/server/extension-auth.js';
import { database } from '#lib/server/db/connection.js';
import { bookmarkHighlights, entities } from '#lib/server/db/schema.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';

/**
 * Highlights saved on one page, looked up by the SHA-256 of its canonical URL. The extension
 * only asks for pages listed in the catalog's `highlightedUrls`, so browsing history never
 * reaches the server.
 */
export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireExtensionOwner(event.request);
		const urlHash = event.url.searchParams.get('urlHash') ?? '';
		if (!/^[a-f0-9]{64}$/.test(urlHash))
			throw new ApiError(400, 'invalid_url_hash', 'Choose a valid page.');
		const rows = await database()
			.select({
				id: bookmarkHighlights.id,
				text: bookmarkHighlights.text,
				prefix: bookmarkHighlights.prefix,
				suffix: bookmarkHighlights.suffix
			})
			.from(bookmarkHighlights)
			.innerJoin(
				entities,
				and(
					eq(entities.vaultId, bookmarkHighlights.vaultId),
					eq(entities.id, bookmarkHighlights.bookmarkId)
				)
			)
			.where(
				and(
					eq(bookmarkHighlights.vaultId, owner.vaultId),
					eq(entities.urlHash, urlHash),
					isNull(entities.deletedAt)
				)
			)
			.orderBy(asc(bookmarkHighlights.createdAt))
			.limit(500);
		return Response.json({ highlights: rows }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
