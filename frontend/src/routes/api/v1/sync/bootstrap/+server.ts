import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { timed } from '#lib/server/timing.js';
import { startBootstrap } from '#lib/server/vault/bootstrap.js';
export const POST: RequestHandler = async (event) => {
	try {
		return Response.json(
			await timed(event, 'sync', async () => startBootstrap(await requireOwner(event))),
			{
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
