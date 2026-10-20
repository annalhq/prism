import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { pullChanges } from '#lib/server/vault/sync.js';
export const GET: RequestHandler = async (event) => {
	try {
		return Response.json(
			await pullChanges(await requireOwner(event), event.url.searchParams.get('cursor') ?? ''),
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
