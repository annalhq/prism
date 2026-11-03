import type { RequestHandler } from './$types';
import { and, arrayContains, desc, eq, isNull } from 'drizzle-orm';
import { requireOwner } from '#lib/server/auth.js';
import { createExtensionPairing } from '#lib/server/extension-auth.js';
import { ApiError, apiErrorResponse } from '#lib/server/http.js';
import { boundedRequest } from '#lib/server/request-policy.js';
import { database } from '#lib/server/db/connection.js';
import { deviceTokens } from '#lib/server/db/schema.js';
import { uuid } from '#lib/domain/validation-fields.js';

const extensionScopes = ['catalog:read', 'bookmark:create'];

export const GET: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		const rows = await database()
			.select({
				id: deviceTokens.id,
				name: deviceTokens.name,
				createdAt: deviceTokens.createdAt,
				lastUsedAt: deviceTokens.lastUsedAt
			})
			.from(deviceTokens)
			.where(
				and(
					eq(deviceTokens.vaultId, owner.vaultId),
					arrayContains(deviceTokens.scopes, extensionScopes),
					isNull(deviceTokens.revokedAt)
				)
			)
			.orderBy(desc(deviceTokens.createdAt));
		return Response.json({ connections: rows }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		const databaseCode =
			error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
		if (databaseCode === '42P01' || databaseCode === '42703') {
			return apiErrorResponse(
				new ApiError(
					503,
					'extension_schema_unavailable',
					'Browser extension storage is not initialized. Apply reviewed database migration 0005.'
				),
				event.locals.requestId
			);
		}
		throw error;
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			throw new ApiError(415, 'json_required', 'Use application/json.');
		const request = await boundedRequest(event.request, 4096);
		let input: unknown;
		try {
			input = await request.json();
		} catch {
			throw new ApiError(400, 'invalid_json', 'Enter a valid pairing request.');
		}
		if (!input || typeof input !== 'object' || !('expiresInMinutes' in input))
			throw new ApiError(
				400,
				'invalid_expiry',
				'Choose a pairing lifetime of 5, 15, or 60 minutes.'
			);
		const result = await createExtensionPairing(
			owner,
			(input as { expiresInMinutes: number }).expiresInMinutes
		);
		return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		const databaseCode =
			error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
		if (databaseCode === '42P01' || databaseCode === '42703') {
			return apiErrorResponse(
				new ApiError(
					503,
					'extension_schema_unavailable',
					'Browser extension storage is not initialized. Apply reviewed database migration 0005.'
				),
				event.locals.requestId
			);
		}
		throw error;
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const owner = await requireOwner(event);
		let id: string;
		try {
			id = uuid(event.url.searchParams.get('id'));
		} catch {
			throw new ApiError(400, 'invalid_connection_id', 'Choose a valid extension connection.');
		}
		const result = await database()
			.update(deviceTokens)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(deviceTokens.vaultId, owner.vaultId),
					eq(deviceTokens.id, id),
					arrayContains(deviceTokens.scopes, extensionScopes),
					isNull(deviceTokens.revokedAt)
				)
			)
			.returning({ id: deviceTokens.id });
		if (!result.length)
			throw new ApiError(404, 'connection_not_found', 'Extension connection not found.');
		return Response.json({ revoked: true }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		throw error;
	}
};
