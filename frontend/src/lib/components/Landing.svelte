<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import { online } from 'svelte/reactivity/window';
	import { resolve } from '$app/paths';
	import type { SharkSpec } from '#lib/ocean/world.js';
	import AsciiOcean from './AsciiOcean.svelte';
	import Brand from './ui/Brand.svelte';
	import ThemeToggle from './ui/ThemeToggle.svelte';
	let { openOffline }: { openOffline?: () => void } = $props();
	// Undefined during server rendering, so the offline button only appears once the browser says so.
	const offline = $derived(online.current === false);
	const sharks: SharkSpec[] = [
		{ kind: 'hammerhead', size: 1 },
		{ kind: 'mako', size: 0.84 },
		{ kind: 'classic', size: 0.78 },
		{ kind: 'thresher', size: 0.72 }
	];
</script>

<a class="skip-link" href="#landing-main">Skip to content</a>
<!-- The sharks own the page; the water darkens toward the bottom edge, where the copy rests. -->
<div class="landing">
	<AsciiOcean class="landing-ocean" {sharks} />
	<div class="landing-vignette" aria-hidden="true"></div>
	<header class="landing-chrome">
		<span class="landing-glass landing-brand"><Brand /></span>
		<ThemeToggle class="landing-glass landing-theme" />
	</header>

	<main id="landing-main" class="landing-hero" tabindex="-1">
		<div class="landing-card">
			<p class="landing-eyebrow"><span aria-hidden="true"></span>Bookmarks · People · Notes</p>
			<h1>Every link you keep,<br /><span class="landing-soft">one keystroke away.</span></h1>
			<p class="landing-lede">A quiet, private library for bookmarks, people and notes.</p>
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
