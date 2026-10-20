import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { readPersonIdentities } from '#lib/server/vault/person-reads.js';
import { entityId } from '#lib/server/vault/read-parameters.js';

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const after = event.url.searchParams.get('after');
		return Response.json(
			await readPersonIdentities(
				owner,
				entityId(event.params.id),
				after === null ? undefined : entityId(after)
			),
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
