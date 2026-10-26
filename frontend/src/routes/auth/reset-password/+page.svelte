<script lang="ts">
	import { KeyRound as KeyRoundIcon } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import AuthLayout from '#lib/components/AuthLayout.svelte';
	let { data, form } = $props();
	let pending = $state(false);
</script>

<svelte:head
	><title>Set password · Prism</title><meta name="referrer" content="same-origin" /></svelte:head
>

<AuthLayout>
	<div class="auth-step">
		<span class="auth-icon" aria-hidden="true"><KeyRoundIcon /></span>
		<h1 id="password-heading">Set a new password</h1>
		<p class="auth-intro">Choose a new password for your library.</p>
		{#if !data.configured}<p class="notice">Password setup is not configured on this deployment.</p>
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
						placeholder="Enter it again"
					/>
				</div>
				<div class="auth-actions">
					<button class="primary-button auth-submit" disabled={pending}
						>{pending ? 'Saving password…' : 'Save password'}</button
					>
				</div>
			</form>
		{/if}
		{#if form?.message}<p role="alert" class="auth-error">{form.message}</p>{/if}
		<div class="auth-actions">
			<a class="text-button auth-link" href={resolve('/auth/sign-in')}>Back to sign in</a>
		</div>
	</div>
</AuthLayout>
