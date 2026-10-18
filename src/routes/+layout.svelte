<script lang="ts">
	import '../app.css';
	import { asset } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURL } from 'svelte/reactivity';
	import { onMount } from 'svelte';
	import { initializeSounds } from '#lib/client/sounds.svelte.js';
	onMount(initializeSounds);
	let { children } = $props();
	const socialImage = $derived(new SvelteURL(asset('og-image.png'), page.url.origin).href);
</script>

<svelte:head>
	<link rel="icon" href={asset('favicon.svg')} type="image/svg+xml" />
	<link rel="icon" href={asset('favicon-32x32.png')} type="image/png" sizes="32x32" />
	<link rel="apple-touch-icon" href={asset('apple-touch-icon.png')} sizes="180x180" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Prism" />
	<meta property="og:title" content="Prism · Your bookmarks, together." />
	<meta
		property="og:description"
		content="A personal space for saved content, people and connections."
	/>
	<meta property="og:image" content={socialImage} />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="The monochrome Prism logo on a charcoal background." />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Prism · Your bookmarks, together." />
	<meta
		name="twitter:description"
		content="A personal space for saved content, people and connections."
	/>
	<meta name="twitter:image" content={socialImage} />
	<meta name="twitter:image:alt" content="The monochrome Prism logo on a charcoal background." />
</svelte:head>

{@render children()}
