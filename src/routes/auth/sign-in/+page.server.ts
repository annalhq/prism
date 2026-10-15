import { fail, redirect } from '@sveltejs/kit';
import {
	authConfigured,
	authFor,
	authSettings,
	isOwnerEmail,
	ownerSession
} from '#lib/server/auth.js';
import { boundedRequest, limitSignIn } from '#lib/server/request-policy.js';
import { ApiError } from '#lib/server/http.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const passwordUpdated = event.url.searchParams.get('password') === 'updated';
	if (!authConfigured())
		return { configured: false, signedIn: false, message: null, passwordUpdated };
	try {
		return {
			configured: true,
			signedIn: !!(await ownerSession(event)),
			message: null,
			passwordUpdated
		};
	} catch (error) {
		return {
			configured: true,
			passwordUpdated,
			signedIn: false,
			message: error instanceof ApiError ? error.message : 'Sign-in is temporarily unavailable.'
		};
	}
};

export const actions = {
	requestReset: async (event) => {
		if (!authConfigured())
			return fail(503, { message: 'Password setup is not configured on this deployment.' });
		limitSignIn(event.getClientAddress());
		const form = await (await boundedRequest(event.request, 16_384)).formData();
		const email = form.get('email');
		if (typeof email !== 'string' || email.length > 320 || !email.trim()) {
			return fail(400, { message: 'Enter your account email to request a password setup link.' });
		}
		try {
			if (await isOwnerEmail(email)) {
				const { error } = await authFor(event).requestPasswordReset({
					email: email.trim(),
					redirectTo: `${authSettings().origin}/auth/reset-password`
				});
				if (error)
					return fail(503, {
						message:
							'Could not request the password email. Check Neon Auth email authentication, email delivery and trusted-domain settings.'
					});
			}
		} catch {
			return fail(503, { message: 'Password setup is temporarily unavailable. Please try again.' });
		}
		return {
			resetRequested: true,
			message:
				'If this email matches the owner account, a password setup link has been requested. Check your inbox and spam folder.'
		};
	},
	signIn: async (event) => {
		if (!authConfigured())
			return fail(503, {
				message: 'Configure Neon Auth and the owner identity to enable sign-in.'
			});
		limitSignIn(event.getClientAddress());
		const form = await (await boundedRequest(event.request, 16_384)).formData();
		const email = form.get('email');
		const password = form.get('password');
		if (
			typeof email !== 'string' ||
			typeof password !== 'string' ||
			email.length > 320 ||
			password.length > 128 ||
			!email.trim() ||
			!password
		) {
			return fail(400, { message: 'Enter a valid email and password.' });
		}
		try {
			const auth = authFor(event);
			const { data, error } = await auth.signIn.email({ email: email.trim(), password });
			if (error || !data?.user)
				return fail(error?.status === 429 ? 429 : 400, {
					message: 'Unable to sign in. Check your credentials or try again later.'
				});
			if (data.user.id !== authSettings().subject) {
				await auth.signOut();
				return fail(403, { message: 'This library is restricted to its owner.' });
			}
		} catch {
			return fail(503, { message: 'The sign-in service is temporarily unavailable.' });
		}
		// Never accept a caller-controlled callback URL.
		redirect(303, '/');
	},
	signOut: async (event) => {
		try {
			const { error } = await authFor(event).signOut();
			if (error) return fail(503, { message: 'Could not sign out. Please try again.' });
		} catch {
			return fail(503, { message: 'The sign-in service is temporarily unavailable.' });
		}
		redirect(303, '/auth/sign-in');
	}
} satisfies Actions;
