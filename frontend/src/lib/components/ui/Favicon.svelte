<script lang="ts">
	import { Globe } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import {
		discoverFavicons,
		faviconSources,
		forgetFavicon,
		isBlankFavicon,
		rememberedFavicon,
		rememberFavicon
	} from '#lib/client/favicons.js';
	let { url }: { url: string | null } = $props();
	let element: HTMLSpanElement;
	let visible = $state(false);
	// `known` is the icon remembered from an earlier visit; `settled` means every source this
	// row will ever try is in `sources`, so running out of them proves the site has no icon.
	let icons = $state<{
		url: string | null;
		sources: string[];
		failed: string[];
		known?: string | null;
		settled: boolean;
	}>({ url: null, sources: [], failed: [], settled: false });
	const sources = $derived(icons.url === url ? icons.sources : faviconSources(url));
	const source = $derived(
		sources.find((candidate) => icons.url !== url || !icons.failed.includes(candidate))
	);
	function skipIcon(candidate: string | null, page: string | null) {
		if (!candidate || page !== url || candidate !== source) return;
		if (candidate === icons.known) {
			// The remembered icon broke; forget it and look for a new one.
			forgetFavicon(url);
			icons = { ...icons, known: undefined, settled: false };
		}
		icons = { ...icons, failed: [...(icons.url === url ? icons.failed : []), candidate] };
	}
	onMount(() => {
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					visible = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '100px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});
	$effect(() => {
		const currentUrl = url;
		const known = rememberedFavicon(currentUrl);
		const fallback = faviconSources(currentUrl);
		icons = {
			url: currentUrl,
			sources:
				known === null ? [] : known ? [known, ...fallback.filter((s) => s !== known)] : fallback,
			failed: [],
			known,
			settled: known !== undefined
		};
	});
	$effect(() => {
		const currentUrl = url;
		if (!visible || !currentUrl || icons.url !== currentUrl || icons.settled) return;
		let cancelled = false;
		void discoverFavicons(currentUrl).then((found) => {
			if (!cancelled && icons.url === currentUrl)
				icons = { ...icons, sources: found, settled: true };
		});
		return () => {
			cancelled = true;
		};
	});
	$effect(() => {
		if (!source && url && icons.url === url && icons.settled && icons.sources.length)
			rememberFavicon(url, null);
	});
</script>

<span bind:this={element} class="favicon" class:fallback={!source} aria-hidden="true">
	{#if source}
		{#key source}
			<img
				src={source}
				alt=""
				width="20"
				height="20"
				loading="lazy"
				referrerpolicy="no-referrer"
				onload={async (event) => {
					const loaded = event.currentTarget.getAttribute('src');
					const page = url;
					if (!loaded) return;
					if (await isBlankFavicon(loaded)) skipIcon(loaded, page);
					else if (page === url) rememberFavicon(page, loaded);
				}}
				onerror={(event) => {
					skipIcon(event.currentTarget.getAttribute('src'), url);
				}}
			/>
		{/key}
	{:else}<Globe />{/if}
</span>
