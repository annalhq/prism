import { authConfigured, requireOwner } from '#lib/server/auth.js';
import { ApiError } from '#lib/server/http.js';
import type { RequestEvent } from '@sveltejs/kit';

export const loadLibrarySession = async (event: RequestEvent) => {
	// Only the credential-free sign-in shell may be cached for explicit offline access.
	event.setHeaders({
		'Cache-Control': event.request.headers.has('cookie')
			? 'no-store'
			: 'public, max-age=0, must-revalidate'
	});
	if (!authConfigured())
		return { configured: false, signedIn: false, identity: null, message: null };
	try {
		const identity = event.request.headers.get('cookie') ? await requireOwner(event) : null;
		return { configured: true, signedIn: !!identity, identity, message: null };
	} catch (error) {
		return {
			configured: true,
			signedIn: false,
			identity: null,
			message:
				error instanceof ApiError
					? error.status === 401
						? null
						: error.message
					: 'Sign-in is temporarily unavailable.'
		};
	}
};
