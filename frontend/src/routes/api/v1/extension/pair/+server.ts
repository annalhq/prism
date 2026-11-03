import type { RequestHandler } from './$types';
import { redeemExtensionPairing } from '#lib/server/extension-auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { boundedRequest } from '#lib/server/request-policy.js';

export const POST: RequestHandler = async (event) => {
	try {
		if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			throw new ApiError(415, 'json_required', 'Use application/json.');
		const request = await boundedRequest(event.request, 4096);
		let input: unknown;
		try {
			input = await request.json();
		} catch {
			throw new ApiError(400, 'invalid_json', 'Enter a valid pairing code.');
		}
		const code =
			input && typeof input === 'object' ? (input as { code?: unknown }).code : undefined;
		if (typeof code !== 'string')
			throw new ApiError(400, 'invalid_pairing_code', 'Enter a valid pairing code.');
		const requested =
			input && typeof input === 'object' ? (input as { browser?: unknown }).browser : undefined;
		const browser = requested === 'chrome' ? 'chrome' : 'firefox';
		const { token, connectionId } = await redeemExtensionPairing(code, browser);
		return Response.json({ token, connectionId }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
