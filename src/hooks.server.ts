import { APP_ORIGIN } from '$app/env/private';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { requireOwner } from '#lib/server/auth.js';
import { ApiError, apiErrorResponse, safeErrorDetails } from '#lib/server/http.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	const api = event.url.pathname.startsWith('/api/v1/');
	const authPage = event.url.pathname.startsWith('/auth/');
	try {
		if ((api || authPage) && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
			const origin = event.request.headers.get('origin');
			if (!origin || origin !== APP_ORIGIN || event.url.origin !== origin) {
				throw new ApiError(403, 'origin_denied', 'This write must originate from the application.');
			}
			const limit = authPage ? 16_384 : 1_048_576;
			const length = event.request.headers.get('content-length');
			if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
				throw new ApiError(413, 'body_too_large', 'Request body exceeds the limit.');
			}
		}
		if (api) await requireOwner(event);
		const response = await resolve(event);
		if (api || authPage) response.headers.set('Cache-Control', 'no-store');
		// Native form POSTs need a non-opaque Origin. Suppress referrers only off-origin.
		if (authPage) response.headers.set('Referrer-Policy', 'same-origin');
		response.headers.set('X-Request-Id', event.locals.requestId);
		response.headers.set('X-Content-Type-Options', 'nosniff');
		return response;
	} catch (error) {
		if (error instanceof ApiError) return apiErrorResponse(error, event.locals.requestId);
		// Never expose provider messages, SQL or connection strings.
		console.error('prism.request.failed', {
			requestId: event.locals.requestId,
			...safeErrorDetails(error)
		});
		return apiErrorResponse(error, event.locals.requestId);
	}
};

export const handleError: HandleServerError = ({ event, error }) => {
	console.error('prism.request.unhandled', {
		requestId: event.locals.requestId,
		...safeErrorDetails(error)
	});
	return { message: 'The request could not be completed.' };
};
