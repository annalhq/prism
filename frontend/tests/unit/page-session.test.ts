import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { ApiError } from '../../src/lib/server/http.js';

const auth = vi.hoisted(() => ({ configured: vi.fn(), owner: vi.fn() }));
vi.mock('../../src/lib/server/auth.js', () => ({
	authConfigured: auth.configured,
	requireOwner: auth.owner
}));
import { loadLibrarySession } from '../../src/lib/server/page-session.js';

function event(cookie = 'session=synthetic') {
	return {
		request: new Request('https://prism.example/', { headers: cookie ? { cookie } : {} }),
		setHeaders: vi.fn()
	} as unknown as RequestEvent;
}
beforeEach(() => {
	vi.resetAllMocks();
	auth.configured.mockReturnValue(true);
});
describe('verified owner supplied by the server page load', () => {
	it('includes the verified vault identity in a private, uncacheable response', async () => {
		const owner = { subject: 'owner', vaultId: 'vault' };
		auth.owner.mockResolvedValue(owner);
		const request = event();
		expect(await loadLibrarySession(request)).toEqual({
			configured: true,
			signedIn: true,
			identity: owner,
			message: null
		});
		expect(auth.owner).toHaveBeenCalledExactlyOnceWith(request);
		expect(request.setHeaders).toHaveBeenCalledWith({ 'Cache-Control': 'no-store' });
	});
	it('keeps the credential-free shell public without exposing an identity', async () => {
		const request = event('');
		expect(await loadLibrarySession(request)).toMatchObject({
			signedIn: false,
			identity: null,
			message: null
		});
		expect(auth.owner).not.toHaveBeenCalled();
		expect(request.setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'public, max-age=0, must-revalidate'
		});
	});
	it('treats expired sessions as signed out and preserves other authorization errors', async () => {
		auth.owner.mockRejectedValue(new ApiError(401, 'sign_in_required', 'Sign in.'));
		expect(await loadLibrarySession(event())).toMatchObject({
			signedIn: false,
			identity: null,
			message: null
		});
		auth.owner.mockRejectedValue(new ApiError(403, 'owner_required', 'This is a private library.'));
		expect(await loadLibrarySession(event())).toMatchObject({
			signedIn: false,
			identity: null,
			message: 'This is a private library.'
		});
	});
});
