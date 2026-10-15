import {
	DATABASE_URL,
	APP_ORIGIN,
	NEON_AUTH_BASE_URL,
	NEON_AUTH_COOKIE_SECRET,
	OWNER_SUBJECT
} from '$app/env/private';
import type { RequestEvent } from '@sveltejs/kit';
import {
	createAuthServer,
	extractNeonAuthCookies,
	NEON_AUTH_SESSION_DATA_COOKIE_NAME
} from '@neondatabase/auth/server';
import { eq, sql } from 'drizzle-orm';
import { database } from './db/connection';
import { vaults } from './db/schema';
import { ApiError } from './http';

export type OwnerContext = Readonly<{ subject: string; vaultId: string }>;

export function authConfigured(): boolean {
	return !!(NEON_AUTH_BASE_URL && NEON_AUTH_COOKIE_SECRET && OWNER_SUBJECT && APP_ORIGIN);
}

export function authSettings() {
	if (!authConfigured())
		throw new ApiError(503, 'auth_not_configured', 'Sign-in is not configured on this deployment.');
	const baseUrl = new URL(NEON_AUTH_BASE_URL!);
	const origin = new URL(APP_ORIGIN!);
	if (
		baseUrl.protocol !== 'https:' ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new ApiError(503, 'auth_configuration_invalid', 'Auth must use a secure service URL.');
	}
	if (
		origin.origin !== APP_ORIGIN ||
		(origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
	) {
		throw new ApiError(503, 'auth_configuration_invalid', 'Configure a secure application origin.');
	}
	if (NEON_AUTH_COOKIE_SECRET!.length < 32) {
		throw new ApiError(
			503,
			'auth_configuration_invalid',
			'Configure an auth cookie signing secret of at least 32 characters.'
		);
	}
	return {
		baseUrl: baseUrl.href,
		origin: origin.origin,
		cookieSecret: NEON_AUTH_COOKIE_SECRET!,
		subject: OWNER_SUBJECT!
	};
}

export function authFor(event: RequestEvent) {
	const settings = authSettings();
	return createAuthServer({
		baseUrl: settings.baseUrl,
		cookieSecret: settings.cookieSecret,
		sameSite: 'lax',
		context: () => ({
			// Force identity reads upstream instead of authorizing from a cached session_data cookie.
			getCookies: () =>
				extractNeonAuthCookies(event.request.headers.get('cookie') ?? '')
					.split(';')
					.filter((part) => part.trim().split('=')[0] !== NEON_AUTH_SESSION_DATA_COOKIE_NAME)
					.join(';'),
			setCookie: (name, value, options) =>
				event.cookies.set(name, value, {
					...options,
					path: options.path ?? '/',
					secure: settings.origin.startsWith('https:'),
					httpOnly: true,
					sameSite: 'lax'
				}),
			getHeader: (name) => event.request.headers.get(name),
			getOrigin: () => settings.origin,
			getFramework: () => 'sveltekit'
		})
	});
}

export async function ownerSession(event: RequestEvent) {
	const settings = authSettings();
	if (!event.request.headers.get('cookie')) return null;
	const { data, error } = await authFor(event).getSession();
	if (error) {
		if (error.status === 401) return null;
		throw new ApiError(503, 'auth_unavailable', 'The sign-in service is temporarily unavailable.');
	}
	if (!data?.user || !data.session || new Date(data.session.expiresAt).getTime() <= Date.now())
		return null;
	if (data.user.id !== settings.subject)
		throw new ApiError(403, 'owner_required', 'This is a private library.');
	return { subject: data.user.id };
}

export function requireOwner(event: RequestEvent): Promise<OwnerContext> {
	return (event.locals.owner ??= resolveOwner(event));
}

async function resolveOwner(event: RequestEvent): Promise<OwnerContext> {
	const session = await ownerSession(event);
	if (!session) throw new ApiError(401, 'sign_in_required', 'Sign in to access this library.');
	if (!DATABASE_URL)
		throw new ApiError(503, 'database_not_configured', 'Database access is not configured.');
	const [vault] = await database()
		.select({ id: vaults.id })
		.from(vaults)
		.where(eq(vaults.ownerSubject, session.subject))
		.limit(1);
	if (!vault)
		throw new ApiError(
			503,
			'vault_not_initialized',
			'Initialize the configured owner vault before continuing.'
		);
	return Object.freeze({ subject: session.subject, vaultId: vault.id });
}

// Used only to request owner recovery. Do not return addresses or hashes to the client.
export async function isOwnerEmail(email: string): Promise<boolean> {
	const settings = authSettings();
	const result = await database().execute<{ matches: boolean }>(sql`
		SELECT EXISTS(SELECT 1 FROM neon_auth."user"
		WHERE id = ${settings.subject} AND lower(email) = lower(${email.trim()})) AS matches
	`);
	return result.rows[0]?.matches === true;
}
