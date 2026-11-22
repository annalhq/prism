import type { RequestHandler } from './$types';
import { asc, eq } from 'drizzle-orm';
import { requireOwner } from '#lib/server/auth.js';
import { database } from '#lib/server/db/connection.js';
import { bookmarkHighlights } from '#lib/server/db/schema.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';

/** Most passages one library read returns; past this the description stands in for the rest. */
const MAX_HIGHLIGHTS = 5000;

/**
 * Every passage saved from the extension, oldest first, for the library's highlight views.
 * They are not part of the synced replica, so the library reads them here when it needs them.
 */
export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const rows = await database()
			.select({
				id: bookmarkHighlights.id,
				bookmarkId: bookmarkHighlights.bookmarkId,
				text: bookmarkHighlights.text,
				createdAt: bookmarkHighlights.createdAt
			})
			.from(bookmarkHighlights)
			.where(eq(bookmarkHighlights.vaultId, owner.vaultId))
			.orderBy(asc(bookmarkHighlights.createdAt), asc(bookmarkHighlights.id))
			.limit(MAX_HIGHLIGHTS);
		return Response.json({ highlights: rows }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
