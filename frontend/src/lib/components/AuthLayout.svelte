<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { setTheme, themePreference } from '#lib/client/theme.svelte.js';
	import type { SharkSpec } from '#lib/ocean/world.js';
	import AsciiOcean from './AsciiOcean.svelte';
	import Brand from './ui/Brand.svelte';
	let { children }: { children: Snippet } = $props();
	const sharks: SharkSpec[] = [
		{ kind: 'hammerhead', size: 1 },
		{ kind: 'mako', size: 0.84 },
		{ kind: 'classic', size: 0.78 },
		{ kind: 'thresher', size: 0.72 }
	];
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<!-- Sharks swim behind everything; the form floats over them on a frosted card. -->
<div class="auth-page">
	<AsciiOcean class="auth-ocean" {sharks} />
	<header class="auth-chrome">
		<Brand auth />
		<button
			class="icon-button auth-theme"
			aria-label={themePreference.value === 'light'
				? 'Use dark appearance'
				: 'Use light appearance'}
			onclick={() => setTheme(themePreference.value === 'light' ? 'dark' : 'light')}
			>{#if themePreference.value === 'light'}<Moon />{:else}<Sun />{/if}</button
		>
	</header>
	<div class="auth-tagline" aria-hidden="true">
		<p>Every link you keep, one keystroke away.</p>
	</div>
	<main id="auth-main" class="auth-sheet" tabindex="-1">
		<div class="auth-sheet-handle" aria-hidden="true"></div>
		{@render children()}
	</main>
</div>
