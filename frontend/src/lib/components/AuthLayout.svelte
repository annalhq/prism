<script lang="ts">
	import { ArrowLeft, Moon, Sun } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { setTheme, themePreference } from '#lib/client/theme.svelte.js';
	import Brand from './ui/Brand.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<!-- A plain, centred column: the landing page carries the personality, sign-in stays out of the way. -->
<div class="auth-page">
	<header class="auth-chrome">
		<a class="text-button auth-back" href={resolve('/')}><ArrowLeft />Back</a>
		<button
			class="icon-button auth-theme"
			aria-label={themePreference.value === 'light'
				? 'Use dark appearance'
				: 'Use light appearance'}
			onclick={() => setTheme(themePreference.value === 'light' ? 'dark' : 'light')}
			>{#if themePreference.value === 'light'}<Moon />{:else}<Sun />{/if}</button
		>
	</header>
	<main id="auth-main" class="auth-sheet" tabindex="-1">
		<div class="auth-brand-mark"><Brand compact /></div>
		{@render children()}
	</main>
</div>
