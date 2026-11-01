<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { SharkSpec } from '#lib/ocean/world.js';
	import AsciiOcean from './AsciiOcean.svelte';
	import Brand from './ui/Brand.svelte';
	import ThemeToggle from './ui/ThemeToggle.svelte';
	let { children }: { children: Snippet } = $props();
	// Fewer, smaller sharks than the landing page: the water stays alive behind the form
	// without competing with it.
	const sharks: SharkSpec[] = [
		{ kind: 'mako', size: 0.8 },
		{ kind: 'classic', size: 0.66 }
	];
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<!-- The landing page's ocean carries on behind sign-in; the form is the app's own shell,
     floating over the water: a panel at the side on wide screens, a sheet at the foot on phones. -->
<div class="auth-page">
	<AsciiOcean class="auth-ocean" {sharks} />
	<div class="auth-vignette" aria-hidden="true"></div>
	<header class="auth-chrome">
		<a class="landing-glass auth-back" href={resolve('/')}><ArrowLeft />Back</a>
	</header>
	<div class="auth-aside" aria-hidden="true">
		<p class="auth-aside-title">
			A quiet place<br /><span class="landing-soft">for everything you keep.</span>
		</p>
	</div>
	<main id="auth-main" class="auth-sheet" tabindex="-1">
		<div class="auth-sheet-head">
			<Brand compact /><ThemeToggle class="auth-theme" />
		</div>
		<div class="auth-sheet-body">{@render children()}</div>
	</main>
</div>
