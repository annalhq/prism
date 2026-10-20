import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { readPerson } from '#lib/server/vault/person-reads.js';
import { entityId } from '#lib/server/vault/read-parameters.js';

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		return Response.json(await readPerson(owner, entityId(event.params.id)), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
