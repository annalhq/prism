<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import Brand from '#lib/components/ui/Brand.svelte';
	import IconArrowLeftFill from 'phosphor-icons-svelte/IconArrowLeftFill.svelte';
	import IconArrowRightFill from 'phosphor-icons-svelte/IconArrowRightFill.svelte';
	import IconLockKeyFill from 'phosphor-icons-svelte/IconLockKeyFill.svelte';
	let { data, form } = $props();
	let pending = $state(false);
</script>

<svelte:head
	><title>Set password · Prism</title><meta name="referrer" content="same-origin" /></svelte:head
>

<main class="auth-page auth-simple">
	<header class="auth-header">
		<Brand auth /><span class="auth-header-note">A little more clarity.</span>
	</header>
	<section class="auth-form-panel" aria-labelledby="password-heading">
		<div class="auth-card">
			<span class="auth-form-kicker">YOUR PRIVATE SPACE</span>
			<h1 id="password-heading">A fresh start.</h1>
			<p class="auth-intro">Choose a new password for your library.</p>
			{#if !data.configured}<p class="notice">
					Password setup is not configured on this deployment.
				</p>
			{:else if !data.token}<p class="notice">
					Open the link in your password email, or request a new one from sign-in.
				</p>
			{:else}
				<form
					method="POST"
					class="auth-form"
					use:enhance={() => {
						pending = true;
						return async ({ update }) => {
							try {
								await update();
							} finally {
								pending = false;
							}
						};
					}}
					aria-busy={pending}
				>
					<input type="hidden" name="token" value={data.token} />
					<div class="field">
						<label for="password">New password</label><input
							id="password"
							name="password"
							type="password"
							autocomplete="new-password"
							required
							minlength="8"
							maxlength="128"
							placeholder="At least 8 characters"
						/>
					</div>
					<div class="field">
						<label for="confirm">Confirm password</label><input
							id="confirm"
							name="confirm"
							type="password"
							autocomplete="new-password"
							required
							minlength="8"
							maxlength="128"
							placeholder="Enter your password again"
						/>
					</div>
					<button class="primary-button auth-submit" disabled={pending}
						>{pending ? 'Saving password…' : 'Save password'}<IconArrowRightFill /></button
					>
				</form>
			{/if}
			{#if form?.message}<p role="alert" class="auth-error">{form.message}</p>{/if}
			<a class="auth-back" href={resolve('/auth/sign-in')}><IconArrowLeftFill />Back to sign in</a>
			<p class="auth-private"><IconLockKeyFill /> A private space, just for you.</p>
		</div>
	</section>
	<footer class="auth-footer">
		<span>Thoughtfully collected. Beautifully connected.</span><span
			>Prism / Your private library</span
		>
	</footer>
</main>
