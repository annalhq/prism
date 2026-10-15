import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { readNoteHistory } from '#lib/server/vault/notes.js';
import { entityId, historyBefore } from '#lib/server/vault/read-parameters.js';

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const result = await readNoteHistory(
			owner,
			entityId(event.params.id),
			historyBefore(event.url.searchParams.get('before'))
		);
		return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
