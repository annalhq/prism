<script lang="ts">
	import { resolve } from '$app/paths';
	let { data, form } = $props();
</script>

<svelte:head
	><title>Set password · Prism</title><meta name="referrer" content="same-origin" /></svelte:head
>

<main class="auth-page">
	<a href={resolve('/auth/sign-in')} class="auth-brand">Prism</a>
	<section class="auth-card" aria-labelledby="password-heading">
		<h1 id="password-heading">Choose your password</h1>
		{#if !data.configured}
			<p>Password setup is not configured on this deployment.</p>
		{:else if !data.token}
			<p>
				Open the link in your password setup email, or request a new link from the sign-in page.
			</p>
		{:else}
			<form method="POST" class="auth-form">
				<input type="hidden" name="token" value={data.token} />
				<label for="password">New password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength="8"
					maxlength="128"
				/>
				<label for="confirm">Confirm password</label>
				<input
					id="confirm"
					name="confirm"
					type="password"
					autocomplete="new-password"
					required
					minlength="8"
					maxlength="128"
				/>
				<button class="auth-submit">Save password</button>
			</form>
		{/if}
		{#if form?.message}<p role="alert" class="auth-error">{form.message}</p>{/if}
		<a class="auth-back" href={resolve('/auth/sign-in')}>Back to sign in</a>
	</section>
</main>
