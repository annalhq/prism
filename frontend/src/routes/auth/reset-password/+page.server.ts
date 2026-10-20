import { fail, redirect } from '@sveltejs/kit';
import { authConfigured, authFor } from '#lib/server/auth.js';
import { boundedRequest, limitSignIn } from '#lib/server/request-policy.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const token = url.searchParams.get('token');
	return { configured: authConfigured(), token: token && token.length <= 1024 ? token : null };
};

export const actions = {
	default: async (event) => {
		if (!authConfigured()) return fail(503, { message: 'Password setup is not configured.' });
		limitSignIn(event.getClientAddress());
		const form = await (await boundedRequest(event.request, 16_384)).formData();
		const token = form.get('token');
		const password = form.get('password');
		const confirm = form.get('confirm');
		if (typeof token !== 'string' || !token || token.length > 1024) {
			return fail(400, { message: 'This link is invalid. Request a new password setup link.' });
		}
		if (
			typeof password !== 'string' ||
			password.length < 8 ||
			password.length > 128 ||
			password !== confirm
		) {
			return fail(400, {
				message: 'Use 8–128 characters and enter the same password in both fields.'
			});
		}
		try {
			const { error } = await authFor(event).resetPassword({ token, newPassword: password });
			if (error)
				return fail(400, {
					message:
						'This link may have expired or the password was rejected. Request a new link and try again.'
				});
		} catch {
			return fail(503, { message: 'Password setup is temporarily unavailable. Please try again.' });
		}
		redirect(303, '/auth/sign-in?password=updated');
	}
} satisfies Actions;
