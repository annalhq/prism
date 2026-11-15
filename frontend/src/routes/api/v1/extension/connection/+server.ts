import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { connectionName, requireExtensionConnection } from '#lib/server/extension-auth.js';
import { database } from '#lib/server/db/connection.js';
import { deviceTokens } from '#lib/server/db/schema.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { boundedRequest } from '#lib/server/request-policy.js';

/** Renames the calling extension connection, as shown in Prism's Account panel. */
export const PATCH: RequestHandler = async (event) => {
	try {
		const { owner, connectionId } = await requireExtensionConnection(event.request);
		if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			throw new ApiError(415, 'json_required', 'Use application/json.');
		const request = await boundedRequest(event.request, 4096);
		let input: unknown;
		try {
			input = await request.json();
		} catch {
			throw new ApiError(400, 'invalid_json', 'Enter a valid name.');
		}
		const name = connectionName(
			input && typeof input === 'object' ? (input as { name?: unknown }).name : undefined
		);
		await database()
			.update(deviceTokens)
			.set({ name })
			.where(and(eq(deviceTokens.vaultId, owner.vaultId), eq(deviceTokens.id, connectionId)));
		return Response.json({ name }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
