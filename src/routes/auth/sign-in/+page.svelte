<script lang="ts">
	import { resolve } from '$app/paths';
	let { data, form } = $props();
</script>

<svelte:head><title>Sign in · Prism</title></svelte:head>

<main class="auth-page">
	<a href={resolve('/')} class="auth-brand">Prism</a>
	<section class="auth-card" aria-labelledby="auth-heading">
		<p class="eyebrow">Your private knowledge library</p>
		<h1 id="auth-heading">{data.signedIn ? 'You’re signed in' : 'Welcome back'}</h1>
		{#if !data.configured}
			<p>
				Sign-in is not configured yet. Set up Neon Auth and the owner identity to connect this
				library.
			</p>
		{:else if data.signedIn}
			<p>Your owner session is active.</p>
			<form method="POST" action="?/signOut"><button class="auth-submit">Sign out</button></form>
		{:else}
			{#if data.passwordUpdated}<p role="status" class="auth-hint">
					Password saved. Sign in with your new password.
				</p>{/if}
			<form method="POST" action="?/signIn" class="auth-form">
				<label for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="username"
					required
					maxlength="320"
				/>
				<label for="password">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					maxlength="128"
				/>
				<button class="auth-submit">Sign in</button>
			</form>
			<details class="password-help">
				<summary>Set or reset password</summary>
				<p class="auth-hint">
					No password yet? Request a link to choose one for your existing owner account.
				</p>
				<form method="POST" action="?/requestReset" class="auth-form">
					<label for="reset-email">Account email</label>
					<input
						id="reset-email"
						name="email"
						type="email"
						autocomplete="email"
						required
						maxlength="320"
					/>
					<button class="auth-submit">Email password setup link</button>
				</form>
			</details>
		{/if}
		{#if form?.message || data.message}<p role="alert" class="auth-error">
				{form?.message ?? data.message}
			</p>{/if}
	</section>
</main>
