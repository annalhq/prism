<script lang="ts">
	import {
		ArrowRight as ArrowRightIcon,
		Eye as EyeIcon,
		EyeOff as EyeOffIcon,
		Mail as MailIcon,
		LockKeyhole as LockIcon
	} from '@lucide/svelte';
	import { online } from 'svelte/reactivity/window';
	import { fade, slide, type TransitionConfig } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { cue, foregroundSound } from '#lib/client/sounds.svelte.js';
	import { enhance, applyAction, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import AuthLayout from './AuthLayout.svelte';
	type Response = { message?: string; resetRequested?: boolean } | null;
	let {
		data,
		form = null,
		openOffline
	}: {
		data: {
			configured: boolean;
			signedIn: boolean;
			message?: string | null;
			passwordUpdated?: boolean;
		};
		form?: Response;
		openOffline?: () => void;
	} = $props();
	let showPassword = $state(false),
		pending = $state(''),
		mode = $state<'signin' | 'reset' | 'sent'>('signin'),
		email = $state('');
	let response = $state<Response>(null);
	function switchMode(next: 'signin' | 'reset') {
		mode = next;
		response = null;
	}
	const result = $derived(response ?? form);
	// Once the link is sent, the step itself says so; only failures need a message line.
	const message = $derived(
		mode === 'sent' && result?.resetRequested ? '' : (result?.message ?? data.message)
	);
	const offline = $derived(online.current === false);
	const submit: SubmitFunction = ({ action }) => {
		const stopLoading = foregroundSound();
		pending = action.searchParams.has('/requestReset') ? 'reset' : 'signin';
		response = null;
		return async ({ result }) => {
			pending = '';
			stopLoading();
			cue(result.type === 'failure' || result.type === 'error' ? 'error' : 'success');
			if (result.type === 'failure' || result.type === 'success') {
				response = result.data as typeof response;
				if (response?.resetRequested) mode = 'sent';
			} else if (result.type === 'redirect') await applyAction(result);
			else response = { message: 'Unable to connect. Please try again.' };
		};
	};
	const resetAction = `${resolve('/auth/sign-in')}?/requestReset`;
	// Sign-in and reset share one form: the password field folds away (height and opacity
	// together) instead of the whole step being swapped, so the form never jumps.
	function fold(node: Element): TransitionConfig {
		const base = slide(node, { duration: 300, easing: cubicOut });
		return { ...base, css: (t, u) => `${base.css?.(t, u) ?? ''};opacity:${t}` };
	}
	const textIn = { duration: 220, delay: 60 };
</script>

<AuthLayout>
	{#key mode === 'sent'}<div class="auth-step">
			<!-- Only the words change between sign-in and reset; they fade in place. -->
			{#key mode}<h1 id="auth-heading" in:fade={textIn}>
					{data.signedIn
						? 'Your account'
						: mode === 'sent'
							? 'Check your email'
							: mode === 'reset'
								? 'Reset your password'
								: 'Welcome back'}
				</h1>
				<p class="auth-intro" in:fade={textIn}>
					{#if data.signedIn}You’re signed in on this device.{:else if mode === 'sent'}We’ve sent a
						link to your email:<br /><strong>{email}</strong>{:else if mode === 'reset'}We’ll email
						you a link to set a new password.{:else}Sign in to your private library.{/if}
				</p>{/key}

			{#if !data.configured}<p class="notice">
					Sign-in is not configured yet. Connect the owner account to open this library.
				</p>
			{:else if data.signedIn}
				<div class="auth-actions">
					<a href={resolve('/')} class="primary-button auth-submit"
						>Open your library <ArrowRightIcon /></a
					>
					<form method="POST" action={`${resolve('/auth/sign-in')}?/signOut`}>
						<button class="text-button auth-link">Sign out of this account</button>
					</form>
				</div>
			{:else if mode === 'sent'}
				<div class="auth-actions">
					<button
						type="button"
						class="primary-button auth-submit"
						onclick={() => switchMode('signin')}>Back to sign in</button
					>
					<form method="POST" action={resetAction} use:enhance={submit}>
						<input type="hidden" name="email" value={email} />
						<button class="text-button auth-link" disabled={!!pending}
							>{pending === 'reset' ? 'Sending again…' : 'Resend email'}</button
						>
					</form>
				</div>
			{:else}
				{#if data.passwordUpdated && mode === 'signin'}<p role="status" class="auth-success">
						Password updated. You can sign in now.
					</p>{/if}
				<form
					method="POST"
					action={mode === 'reset' ? resetAction : `${resolve('/auth/sign-in')}?/signIn`}
					class="auth-form"
					use:enhance={submit}
					aria-busy={!!pending}
				>
					<div class="field">
						<label for="email">Email</label>
						<div class="auth-input">
							<MailIcon aria-hidden="true" /><input
								id="email"
								name="email"
								type="email"
								bind:value={email}
								autocomplete={mode === 'reset' ? 'email' : 'username'}
								placeholder="you@example.com"
								required
								maxlength="320"
							/>
						</div>
					</div>
					{#if mode === 'signin'}
						<div class="field" transition:fold>
							<label for="password">Password</label>
							<div class="auth-input">
								<LockIcon aria-hidden="true" /><input
									id="password"
									name="password"
									type={showPassword ? 'text' : 'password'}
									autocomplete="current-password"
									placeholder="Your password"
									required
									maxlength="128"
								/><button
									type="button"
									class="icon-button auth-reveal"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									aria-pressed={showPassword}
									onclick={() => (showPassword = !showPassword)}
									>{#if showPassword}<EyeOffIcon />{:else}<EyeIcon />{/if}</button
								>
							</div>
						</div>
					{/if}
					<div class="auth-actions">
						<button
							class="primary-button auth-submit"
							class:pending={!!pending}
							disabled={!!pending}
							>{#if pending}<span class="auth-spinner" aria-hidden="true"
								></span>{/if}{#if mode === 'reset'}{pending === 'reset'
									? 'Sending link…'
									: 'Send link'}{:else}{pending === 'signin'
									? 'Signing in…'
									: 'Sign in'}{/if}{#if !pending}<ArrowRightIcon />{/if}</button
						>
						<button
							type="button"
							class="text-button auth-link"
							onclick={() => switchMode(mode === 'reset' ? 'signin' : 'reset')}
							>{mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}</button
						>
					</div>
				</form>
			{/if}
			<!-- Keyed so a repeated failure nudges again instead of sitting there unchanged. -->
			{#if message}{#key result}<p
						role={result?.resetRequested ? 'status' : 'alert'}
						class:auth-success={result?.resetRequested}
						class:auth-error={!result?.resetRequested}
					>
						{message}
					</p>{/key}{/if}
			{#if offline && openOffline}<button
					class="text-button auth-link offline-access"
					onclick={openOffline}>Open cached library on this trusted device</button
				>{/if}
		</div>{/key}
</AuthLayout>
