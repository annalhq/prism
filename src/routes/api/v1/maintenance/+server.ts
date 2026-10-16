import type { RequestHandler } from './$types';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { boundedRequest } from '#lib/server/request-policy.js';
import { runMaintenance } from '#lib/server/vault/maintenance.js';

// The API hook requires the configured same origin before this owner-only write.
export const POST: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		if (
			event.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
			'application/json'
		)
			throw new ApiError(415, 'json_required', 'Use application/json for maintenance.');
		const request = await boundedRequest(event.request, 1024);
		let input: unknown;
		try {
			input = await request.json();
		} catch {
			throw new ApiError(400, 'invalid_json', 'Enter a valid maintenance request.');
		}
		if (
			!input ||
			typeof input !== 'object' ||
			Array.isArray(input) ||
			Object.keys(input).some((key) => key !== 'limit')
		)
			throw new ApiError(400, 'invalid_request', 'Use an object containing an optional limit.');
		const requestedLimit = (input as { limit?: unknown }).limit;
		const limit = requestedLimit === undefined ? 1 : requestedLimit;
		if (typeof limit !== 'number')
			throw new ApiError(
				400,
				'invalid_limit',
				'Maintenance limit must be an integer between 1 and 10.'
			);
		return Response.json(await runMaintenance(owner, limit), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
