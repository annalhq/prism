import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { APP_ORIGIN } from '$app/env/private';
import { database, inTransaction } from './db/connection.js';
import { deviceTokens, extensionPairings, vaults } from './db/schema.js';
import { ApiError } from './http.js';
import type { OwnerContext } from './auth.js';

const extensionScopes = ['catalog:read', 'bookmark:create'];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function encodeOrigin(origin: string) {
	return Buffer.from(origin, 'utf8').toString('base64url');
}

function parseOrigin(value: string): string {
	let decoded: string;
	try {
		decoded = Buffer.from(value, 'base64url').toString('utf8');
	} catch {
		throw new ApiError(400, 'invalid_pairing_code', 'This pairing code is invalid.');
	}
	let parsed: URL;
	try {
		parsed = new URL(decoded);
	} catch {
		throw new ApiError(400, 'invalid_pairing_code', 'This pairing code is invalid.');
	}
	if (
		parsed.origin !== decoded ||
		(parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
	) {
		throw new ApiError(
			400,
			'invalid_pairing_code',
			'This pairing code has an unsafe site address.'
		);
	}
	return parsed.origin;
}

export async function createExtensionPairing(owner: OwnerContext, minutes: number) {
	if (![5, 15, 60].includes(minutes))
		throw new ApiError(400, 'invalid_expiry', 'Choose a pairing lifetime of 5, 15, or 60 minutes.');
	if (!APP_ORIGIN)
		throw new ApiError(503, 'origin_not_configured', 'The site address is not configured.');
	let origin: string;
	try {
		const parsed = new URL(APP_ORIGIN);
		if (parsed.origin !== APP_ORIGIN) throw new Error('origin');
		origin = parseOrigin(encodeOrigin(parsed.origin));
	} catch {
		throw new ApiError(503, 'origin_not_configured', 'The site address is not configured safely.');
	}
	const code = `prism1.${encodeOrigin(origin)}.${randomBytes(32).toString('base64url')}`;
	const expiresAt = new Date(Date.now() + minutes * 60_000);
	await database()
		.delete(extensionPairings)
		.where(
			and(eq(extensionPairings.vaultId, owner.vaultId), lt(extensionPairings.expiresAt, new Date()))
		);
	await database()
		.insert(extensionPairings)
		.values({
			vaultId: owner.vaultId,
			codeHash: digest(code),
			expiresAt
		});
	return { code, expiresAt: expiresAt.toISOString() };
}

export function pairingOrigin(code: string): string {
	if (code.length > 1024)
		throw new ApiError(400, 'invalid_pairing_code', 'This pairing code is invalid.');
	const parts = code.trim().split('.');
	if (parts.length !== 3 || parts[0] !== 'prism1' || !/^[A-Za-z0-9_-]{20,128}$/.test(parts[2]))
		throw new ApiError(400, 'invalid_pairing_code', 'This pairing code is invalid.');
	return parseOrigin(parts[1]);
}

export type ExtensionBrowser = 'firefox' | 'chrome';
const browserLabels: Record<ExtensionBrowser, string> = {
	firefox: 'Firefox extension',
	chrome: 'Chrome extension'
};

/** `browser` names the device in the Account panel; older clients send none and were Firefox. */
export async function redeemExtensionPairing(code: string, browser: ExtensionBrowser = 'firefox') {
	const origin = pairingOrigin(code);
	const id = randomUUID();
	const token = `prismext.${id}.${randomBytes(32).toString('base64url')}`;
	const result = await inTransaction(async (tx) => {
		const [pairing] = await tx
			.select()
			.from(extensionPairings)
			.where(eq(extensionPairings.codeHash, digest(code.trim())))
			.for('update');
		if (!pairing || pairing.redeemedAt || pairing.expiresAt.getTime() <= Date.now())
			throw new ApiError(
				410,
				'pairing_expired',
				'This pairing code expired or was already used. Generate a new code on Prism.'
			);
		const [vault] = await tx.select().from(vaults).where(eq(vaults.id, pairing.vaultId)).limit(1);
		if (!vault)
			throw new ApiError(
				410,
				'pairing_expired',
				'This pairing code is no longer available. Generate a new code on Prism.'
			);
		await tx
			.update(extensionPairings)
			.set({ redeemedAt: new Date() })
			.where(eq(extensionPairings.id, pairing.id));
		await tx.insert(deviceTokens).values({
			vaultId: pairing.vaultId,
			id,
			name: browserLabels[browser],
			tokenHash: digest(token),
			scopes: extensionScopes,
			expiresAt: null
		});
		return { subject: vault.ownerSubject, vaultId: pairing.vaultId };
	});
	return { token, connectionId: id, origin, subject: result.subject };
}

export async function requireExtensionOwner(request: Request): Promise<OwnerContext> {
	const authorization = request.headers.get('authorization') ?? '';
	const match = /^Bearer (prismext\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,64})$/.exec(authorization);
	if (!match)
		throw new ApiError(401, 'extension_auth_required', 'Connect the Prism extension again.');
	const [row] = await database()
		.select({
			id: deviceTokens.id,
			vaultId: deviceTokens.vaultId,
			ownerSubject: vaults.ownerSubject,
			scopes: deviceTokens.scopes
		})
		.from(deviceTokens)
		.innerJoin(vaults, eq(vaults.id, deviceTokens.vaultId))
		.where(
			and(
				eq(deviceTokens.tokenHash, digest(match[1])),
				isNull(deviceTokens.revokedAt),
				or(isNull(deviceTokens.expiresAt), sql`${deviceTokens.expiresAt} > now()`)
			)
		)
		.limit(1);
	if (!row || !extensionScopes.every((scope) => row.scopes.includes(scope)))
		throw new ApiError(
			401,
			'extension_auth_invalid',
			'This Prism extension connection was revoked. Connect it again.'
		);
	await database()
		.update(deviceTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(deviceTokens.id, row.id));
	return { subject: row.ownerSubject, vaultId: row.vaultId };
}
