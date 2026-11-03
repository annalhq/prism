import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { timed } from '#lib/server/timing.js';
import { bootstrapPage, releaseBootstrap } from '#lib/server/vault/bootstrap.js';
export const GET: RequestHandler = async (event) => {
	try {
		return Response.json(
			await timed(event, 'sync', async () =>
				bootstrapPage(
					await requireOwner(event),
					event.params.token,
					event.url.searchParams.get('table') ?? '',
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
export const DELETE: RequestHandler = async (event) => {
	try {
		await timed(event, 'sync', async () =>
			releaseBootstrap(await requireOwner(event), event.params.token)
		);
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
