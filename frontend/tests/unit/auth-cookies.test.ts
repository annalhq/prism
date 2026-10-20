import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$app/env/private', () => ({
	APP_ORIGIN: 'http://localhost:5173',
	NEON_AUTH_BASE_URL: 'https://auth.example.test/auth',
	NEON_AUTH_COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-characters',
	OWNER_SUBJECT: 'test-owner',
	DATABASE_URL: ''
}));
vi.mock('@neondatabase/auth/server', () => ({
	createAuthServer: (options: { context: () => unknown }) => options.context(),
	extractNeonAuthCookies: (cookies: string) => cookies,
	NEON_AUTH_SESSION_DATA_COOKIE_NAME: '__Secure-neon-auth.local.session_data'
}));

import { authFor } from '../../src/lib/server/auth.js';

describe('Neon cookies on HTTP localhost', () => {
	for (const name of [
		'__Secure-neon-auth.session_token',
		'__Secure-neon-auth.local.session_data'
	]) {
		for (const maxAge of [3600, 0]) {
			it(`preserves the required Secure attribute for ${name}, maxAge=${maxAge}`, () => {
				const set = vi.fn();
				const event = {
					request: new Request('http://localhost:5173/auth/sign-in'),
					cookies: { set }
				} as unknown as RequestEvent;
				const context = authFor(event) as unknown as {
					setCookie: (name: string, value: string, options: Record<string, unknown>) => void;
				};
				// Exercise the actual app adapter invoked by the SDK, including cookie deletion.
				context.setCookie(name, maxAge ? 'synthetic-session' : '', {
					secure: true,
					path: '/',
					maxAge
				});
				expect(set).toHaveBeenCalledWith(
					name,
					maxAge ? 'synthetic-session' : '',
					expect.objectContaining({
						secure: true,
						httpOnly: true,
						sameSite: 'lax',
						path: '/',
						maxAge
					})
				);
			});
		}
	}
});
