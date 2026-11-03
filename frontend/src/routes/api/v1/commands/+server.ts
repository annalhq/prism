import type { RequestHandler } from './$types';
import { MAX_COMMAND_BYTES } from '#lib/domain/contracts.js';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { timed } from '#lib/server/timing.js';
import { boundedRequest } from '#lib/server/request-policy.js';
import { executeCommand } from '#lib/server/vault/commands.js';

const commandRequest: RequestHandler = async (event) => {
	const owner = await requireOwner(event);
	if (
		event.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
		'application/json'
	)
		throw new ApiError(415, 'json_required', 'Use application/json for commands.');
	const request = await boundedRequest(event.request, MAX_COMMAND_BYTES);
	let input: unknown;
	try {
		input = await request.json();
	} catch {
		throw new ApiError(400, 'invalid_json', 'Enter a valid JSON command envelope.');
	}
	// Post-auth service time; the hook adds session, vault and total request stages.
	const result = await timed(event, 'command', () => executeCommand(owner, input));
	const status =
		result.status !== 'rejected'
			? 200
			: result.error.code === 'invalid_command'
				? 422
				: result.error.code === 'frame_too_large'
					? 413
					: 409;
	return Response.json(result, {
		status,
		headers: { 'Cache-Control': 'no-store' }
	});
};

export const POST: RequestHandler = async (event) => {
	try {
		return await commandRequest(event);
	} catch (error) {
		// The framework handles route exceptions before they reach the outer hook.
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
