import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { timed } from '#lib/server/timing.js';
import { bootstrapBatchPage } from '#lib/server/vault/bootstrap.js';

// Batched bootstrap (`bootstrap-batch-v1`): records from consecutive tables per request.
export const GET: RequestHandler = async (event) => {
	try {
		return Response.json(
			await timed(event, 'sync', async () =>
				bootstrapBatchPage(
					await requireOwner(event),
					event.params.token,
					event.url.searchParams.get('after') ?? ''
				)
			),
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
