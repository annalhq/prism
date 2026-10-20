import type { RequestHandler } from './$types';
import { MAX_COMMAND_BYTES } from '#lib/domain/contracts.js';
import { requireExtensionOwner } from '#lib/server/extension-auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { boundedRequest } from '#lib/server/request-policy.js';
import { executeCommand } from '#lib/server/vault/commands.js';

export const POST: RequestHandler = async (event) => {
	try {
		const owner = await requireExtensionOwner(event.request);
		if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			throw new ApiError(415, 'json_required', 'Use application/json.');
		const request = await boundedRequest(event.request, MAX_COMMAND_BYTES);
		let input: unknown;
		try {
			input = await request.json();
		} catch {
			throw new ApiError(400, 'invalid_json', 'Enter a valid bookmark request.');
		}
		const envelope = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
		if (!envelope.command || typeof envelope.command !== 'object')
			throw new ApiError(400, 'invalid_envelope', 'A bookmark command is required.');
		if ((envelope.command as { type?: unknown }).type !== 'extension.bookmark.create')
			throw new ApiError(403, 'extension_scope_denied', 'This connection can only save bookmarks.');
		const result = await executeCommand(owner, input);
		const status = result.status === 'rejected' ? 409 : 200;
		return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
