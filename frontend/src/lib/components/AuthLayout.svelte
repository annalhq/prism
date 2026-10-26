<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import darkBackground from '#lib/assets/auth-dark.jpg';
	import lightBackground from '#lib/assets/auth-light.jpg';
	import { setTheme, themePreference } from '#lib/client/theme.svelte.js';
	import Brand from './ui/Brand.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<!-- The backdrop is chosen in CSS from [data-theme], so it never flashes the wrong image. -->
<div
	class="auth-page"
	style={`--auth-dark: url(${darkBackground}); --auth-light: url(${lightBackground});`}
>
	<div class="auth-visual" aria-hidden="true"></div>
	<div class="auth-chrome">
		<Brand auth />
		<button
			class="icon-button auth-theme"
			aria-label={themePreference.value === 'light'
				? 'Use dark appearance'
				: 'Use light appearance'}
			onclick={() => setTheme(themePreference.value === 'light' ? 'dark' : 'light')}
			>{#if themePreference.value === 'light'}<Moon />{:else}<Sun />{/if}</button
		>
	</div>
	<p class="auth-tagline" aria-hidden="true">Every link you keep, one keystroke away.</p>
	<main id="auth-main" class="auth-sheet" tabindex="-1">
		<div class="auth-sheet-handle" aria-hidden="true"></div>
		{@render children()}
	</main>
</div>
