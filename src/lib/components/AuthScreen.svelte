<script lang="ts">
	import {
		ArrowRight as ArrowRightIcon,
		Eye as EyeIcon,
		EyeOff as EyeOffIcon,
		LockKeyhole as LockKeyholeIcon,
		ChevronDown as ChevronDownIcon,
		ArrowUpRight as ArrowUpRightIcon
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { enhance, applyAction } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Collapsible } from 'bits-ui';
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
		resetOpen = $state(false),
		offline = $state(false);
	let response = $state<{ message?: string; resetRequested?: boolean } | null>(null);
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
		pending = action.searchParams.has('/requestReset') ? 'reset' : 'signin';
		response = null;
		return async ({ result }) => {
			pending = '';
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
		<section class="auth-form-panel" aria-labelledby="auth-heading">
			<div class="auth-card">
				<span class="auth-form-kicker">{data.signedIn ? 'YOUR ACCOUNT' : 'WELCOME TO PRISM'}</span>
				<h1 id="auth-heading">
					{data.signedIn ? 'Your account' : 'Your bookmarks, together.'}
				</h1>
				<p class="auth-intro">
					{data.signedIn
						? 'You’re signed in to your private library.'
						: 'Save a link. Add context. Find it when you need it.'}
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
						action={`${resolve('/auth/sign-in')}?/signIn`}
						class="auth-form"
						use:enhance={submit}
						aria-busy={pending === 'signin'}
					>
						<div class="field">
							<label for="email">Email address</label><input
								id="email"
								name="email"
								type="email"
								autocomplete="username"
								placeholder="you@example.com"
								required
								maxlength="320"
							/>
						</div>
						<div class="field">
							<div class="field-heading">
								<label for="password">Password</label><button
									type="button"
									class="text-button"
									onclick={() => (resetOpen = !resetOpen)}
									aria-expanded={resetOpen}>Forgot password?</button
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
					</form>
					<Collapsible.Root bind:open={resetOpen} class="password-help">
						<Collapsible.Trigger class="recovery-trigger"
							>First time here? Set up your password <ChevronDownIcon /></Collapsible.Trigger
						>
						<Collapsible.Content class="recovery-content"
							><p>We’ll email a password link to your existing account.</p>
							<form
								method="POST"
								action={`${resolve('/auth/sign-in')}?/requestReset`}
								class="auth-form"
								use:enhance={submit}
							>
								<div class="field">
									<label for="reset-email">Account email</label><input
										id="reset-email"
										name="email"
										type="email"
										autocomplete="email"
										placeholder="you@example.com"
										required
										maxlength="320"
									/>
								</div>
								<button class="secondary-button" disabled={!!pending}
									>{pending === 'reset' ? 'Sending link…' : 'Send password link'}<ArrowUpRightIcon
									/></button
								>
							</form></Collapsible.Content
						>
					</Collapsible.Root>
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
