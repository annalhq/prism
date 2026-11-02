<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import { online } from 'svelte/reactivity/window';
	import { resolve } from '$app/paths';
	import GrainSplit from './GrainSplit.svelte';
	import Brand from './ui/Brand.svelte';
	let { openOffline }: { openOffline?: () => void } = $props();
	// Undefined during server rendering, so the offline button only appears once the browser says so.
	const offline = $derived(online.current === false);
</script>

<a class="skip-link" href="#landing-main">Skip to content</a>
<GrainSplit id="landing-main" landing>
	<div class="grain-card-head"><Brand /></div>
	<div class="grain-card-body landing-copy">
		<div class="landing-intro">
			<h1>Every link you keep,<br /><span class="landing-soft">one keystroke away.</span></h1>
			<p class="landing-lede">A quiet, private library for bookmarks, people and notes.</p>
		</div>
		<div class="landing-actions">
			<a class="primary-button landing-cta" href={resolve('/auth/sign-in')}
				><span>Sign in</span><span class="landing-cta-go"><ArrowRight /></span></a
			>
			{#if offline && openOffline}<button class="text-button landing-offline" onclick={openOffline}
					>Open cached library on this trusted device</button
				>{/if}
		</div>
	</div>
	{#snippet panel()}
		<p class="grain-headline">A quiet place<br />for everything you keep.</p>
	{/snippet}
</GrainSplit>
