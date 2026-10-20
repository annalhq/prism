import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { readBacklinks } from '#lib/server/vault/links.js';
import { entityId } from '#lib/server/vault/read-parameters.js';

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const after = event.url.searchParams.get('after');
		const result = await readBacklinks(
			owner,
			entityId(event.params.id),
			after === null ? undefined : entityId(after)
		);
		return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
