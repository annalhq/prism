import { authConfigured, ownerSession } from '#lib/server/auth.js';
import { ApiError } from '#lib/server/http.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// Only the credential-free sign-in shell may be cached for explicit offline access.
	event.setHeaders({
		'Cache-Control': event.request.headers.has('cookie')
			? 'no-store'
			: 'public, max-age=0, must-revalidate'
	});
	if (!authConfigured()) return { configured: false, signedIn: false, message: null };
	try {
		return { configured: true, signedIn: !!(await ownerSession(event)), message: null };
	} catch (error) {
		return {
			configured: true,
			signedIn: false,
			message: error instanceof ApiError ? error.message : 'Sign-in is temporarily unavailable.'
		};
	}
};
