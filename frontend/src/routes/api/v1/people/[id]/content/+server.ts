import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { feedParameters, readPersonFeed } from '#lib/server/vault/person-reads.js';
import { entityId } from '#lib/server/vault/read-parameters.js';

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const id = entityId(event.params.id);
		return Response.json(
			await readPersonFeed(
				owner,
				id,
				feedParameters(id, event.url.searchParams.get('mode'), event.url.searchParams.get('after'))
			),
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
