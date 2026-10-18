<script lang="ts">
	import {
		ArrowRight as ArrowRightIcon,
		Eye as EyeIcon,
		EyeOff as EyeOffIcon,
		LockKeyhole as LockKeyholeIcon,
		ArrowUpRight as ArrowUpRightIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { cue, foregroundSound } from '#lib/client/sounds.svelte.js';
	import { enhance, applyAction } from '$app/forms';
	import { resolve } from '$app/paths';
	import Brand from './ui/Brand.svelte';
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
		form?: { message?: string; resetRequested?: boolean } | null;
		openOffline?: () => void;
	} = $props();
	let showPassword = $state(false),
		pending = $state(''),
		mode = $state<'signin' | 'reset'>('signin'),
		offline = $state(false);
	let response = $state<{ message?: string; resetRequested?: boolean } | null>(null);
	function switchMode(next: 'signin' | 'reset') {
		mode = next;
		response = null;
	}
	const result = $derived(response ?? form);
	const message = $derived(result?.message ?? data.message);
	onMount(() => {
		const update = () => {
			offline = !navigator.onLine;
		};
		update();
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});
	const submit: import('$app/forms').SubmitFunction = ({ action }) => {
		const stopLoading = foregroundSound();
		pending = action.searchParams.has('/requestReset') ? 'reset' : 'signin';
		response = null;
		return async ({ result }) => {
			pending = '';
			stopLoading();
			cue(result.type === 'failure' || result.type === 'error' ? 'error' : 'success');
			if (result.type === 'failure' || result.type === 'success')
				response = result.data as typeof response;
			else if (result.type === 'redirect') await applyAction(result);
			else response = { message: 'Unable to connect. Please try again.' };
		};
	};
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<main id="auth-main" class="auth-page" tabindex="-1">
	<header class="auth-header">
		<Brand auth /><span class="auth-header-note">Your private library</span>
	</header>
	<div class="auth-layout">
		<section class="auth-story" aria-label="Welcome to Prism">
			<p class="eyebrow">COLLECT A LITTLE WONDER</p>
			<h2>A home for<br />your next <em>idea.</em></h2>
			<p>The links you love. The people behind them.<br />Everything connected, quietly.</p>
			<div class="auth-art" aria-hidden="true">
				<div class="art-orbit"></div>
				<div class="art-card art-card-back"><span></span><span></span></div>
				<div class="art-card art-card-front">
					<span class="art-star">✳</span><strong>Worth keeping.</strong><span></span><span
					></span><small>IDEAS · PEOPLE · POSSIBILITIES</small>
				</div>
			</div>
		</section>
		<section class="auth-form-panel" aria-labelledby="auth-heading">
			<div class="auth-card">
				<span class="auth-form-kicker">{data.signedIn ? 'YOUR ACCOUNT' : 'WELCOME TO PRISM'}</span>
				<h1 id="auth-heading">
					{data.signedIn ? 'Your account' : 'Welcome back.'}
				</h1>
				<p class="auth-intro">
					{data.signedIn
						? 'You’re signed in to your private library.'
						: 'Your next good find starts here.'}
				</p>
				{#if !data.configured}<p class="notice">
						Sign-in is not configured yet. Connect the owner account to open this library.
					</p>
				{:else if data.signedIn}
					<a href={resolve('/')} class="primary-button auth-submit"
						>Open your library <ArrowRightIcon /></a
					>
					<form method="POST" action={`${resolve('/auth/sign-in')}?/signOut`}>
						<button class="text-button auth-signout">Sign out of this account</button>
					</form>
				{:else}
					{#if data.passwordUpdated}<p role="status" class="auth-success">
							Password updated. You can sign in now.
						</p>{/if}
					<form
						method="POST"
						action={`${resolve('/auth/sign-in')}?/${mode === 'reset' ? 'requestReset' : 'signIn'}`}
						class="auth-form"
						use:enhance={submit}
						aria-busy={!!pending}
					>
						<div class="field">
							<label for="email">Email address</label><input
								id="email"
								name="email"
								type="email"
								autocomplete={mode === 'reset' ? 'email' : 'username'}
								placeholder="you@example.com"
								required
								maxlength="320"
							/>
						</div>
						{#if mode === 'reset'}
							<p class="auth-hint">We’ll email a password link to your existing account.</p>
							<button class="primary-button auth-submit" disabled={!!pending}
								>{pending === 'reset' ? 'Sending link…' : 'Send password link'}<ArrowUpRightIcon
								/></button
							>
							<button
								type="button"
								class="text-button auth-back"
								onclick={() => switchMode('signin')}>Back to sign in</button
							>
						{:else}
							<div class="field">
								<div class="field-heading">
									<label for="password">Password</label><button
										type="button"
										class="text-button"
										onclick={() => switchMode('reset')}>Forgot password?</button
									>
								</div>
								<div class="password-input">
									<input
										id="password"
										name="password"
										type={showPassword ? 'text' : 'password'}
										autocomplete="current-password"
										placeholder="Enter your password"
										required
										maxlength="128"
									/><button
										type="button"
										class="icon-button"
										aria-label={showPassword ? 'Hide password' : 'Show password'}
										aria-pressed={showPassword}
										onclick={() => (showPassword = !showPassword)}
										>{#if showPassword}<EyeOffIcon />{:else}<EyeIcon />{/if}</button
									>
								</div>
							</div>
							<button class="primary-button auth-submit" disabled={!!pending}
								>{pending === 'signin' ? 'Signing in…' : 'Sign in'}<ArrowRightIcon /></button
							>
						{/if}
					</form>
				{/if}
				{#if message}<p
						role={result?.resetRequested ? 'status' : 'alert'}
						class:auth-success={result?.resetRequested}
						class:auth-error={!result?.resetRequested}
					>
						{message}
					</p>{/if}
				{#if offline && openOffline}<button
						class="secondary-button offline-access"
						onclick={openOffline}>Open cached library on this trusted device</button
					>{/if}
				<p class="auth-private"><LockKeyholeIcon /> A private space, just for you.</p>
			</div>
		</section>
	</div>
	<footer class="auth-footer">
		<span>Less searching. More finding.</span><span>Prism / Your private library</span>
	</footer>
</main>
