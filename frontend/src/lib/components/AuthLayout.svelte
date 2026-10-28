<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Brand from './ui/Brand.svelte';
	import ThemeToggle from './ui/ThemeToggle.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<a class="skip-link" href="#auth-main">Skip to content</a>
<!-- A plain, centred column: the landing page carries the personality, sign-in stays out of the way. -->
<div class="auth-page">
	<header class="auth-chrome">
		<a class="text-button auth-back" href={resolve('/')}><ArrowLeft />Back</a>
		<ThemeToggle class="auth-theme" />
	</header>
	<main id="auth-main" class="auth-sheet" tabindex="-1">
		<div class="auth-brand-mark"><Brand compact /></div>
		{@render children()}
	</main>
</div>
