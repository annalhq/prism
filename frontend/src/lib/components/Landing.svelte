<script lang="ts">
	import { ArrowRight, Moon, Sun } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { setTheme, themePreference } from '#lib/client/theme.svelte.js';
	import type { SharkSpec } from '#lib/ocean/world.js';
	import AsciiOcean from './AsciiOcean.svelte';
	import Brand from './ui/Brand.svelte';
	let { openOffline }: { openOffline?: () => void } = $props();
	let offline = $state(false);
	onMount(() => {
		const update = () => (offline = !navigator.onLine);
		update();
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});
	const sharks: SharkSpec[] = [
		{ kind: 'hammerhead', size: 1 },
		{ kind: 'mako', size: 0.84 },
		{ kind: 'classic', size: 0.78 },
		{ kind: 'thresher', size: 0.72 }
	];
</script>

<a class="skip-link" href="#landing-main">Skip to content</a>
<!-- The sharks own the page; the copy floats over them on one small frosted card. -->
<div class="landing">
	<AsciiOcean class="landing-ocean" {sharks} />
	<header class="landing-chrome">
		<span class="landing-glass landing-brand"><Brand /></span>
		<button
			class="icon-button landing-glass landing-theme"
			aria-label={themePreference.value === 'light'
				? 'Use dark appearance'
				: 'Use light appearance'}
			onclick={() => setTheme(themePreference.value === 'light' ? 'dark' : 'light')}
			>{#if themePreference.value === 'light'}<Moon />{:else}<Sun />{/if}</button
		>
	</header>

	<main id="landing-main" class="landing-hero" tabindex="-1">
		<div class="landing-glass landing-card">
			<h1>Every link you keep,<br />one keystroke away.</h1>
			<p>A quiet, private library for bookmarks, people and notes.</p>
			<div class="landing-actions">
				<a class="primary-button landing-cta" href={resolve('/auth/sign-in')}
					>Sign in<ArrowRight /></a
				>
				{#if offline && openOffline}<button
						class="text-button landing-offline"
						onclick={openOffline}>Open cached library on this trusted device</button
					>{/if}
			</div>
		</div>
	</main>
	<p class="landing-hint" aria-hidden="true">Tap the water</p>
</div>
