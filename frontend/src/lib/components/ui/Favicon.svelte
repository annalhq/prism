<script lang="ts">
	import { onMount } from 'svelte';
	import { discoverFavicons, faviconSources, isBlankFavicon } from '#lib/client/favicons.js';
	let { url }: { url: string | null } = $props();
	let element: HTMLSpanElement;
	let visible = $state(false);
	let icons = $state<{ url: string | null; sources: string[]; failed: string[] }>({
		url: null,
		sources: [],
		failed: []
	});
	const sources = $derived(icons.url === url ? icons.sources : faviconSources(url));
	const source = $derived(
		sources.find((candidate) => icons.url !== url || !icons.failed.includes(candidate))
	);
	function skipIcon(candidate: string | null, page: string | null) {
		if (candidate && page === url && candidate === source)
			icons = { url, sources, failed: [...(icons.url === url ? icons.failed : []), candidate] };
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
	const origin = $derived.by(() => {
		try {
			const parsed = new URL(url ?? '');
			return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : null;
		} catch {
			return null;
		}
	});
	const letter = $derived(
		origin
			? new URL(origin).hostname
					.replace(/^www\./, '')
					.slice(0, 1)
					.toUpperCase()
			: 'B'
	);
	$effect(() => {
		const currentUrl = url;
		icons = { url: currentUrl, sources: faviconSources(currentUrl), failed: [] };
		if (!visible || !currentUrl) return;
		let cancelled = false;
		void discoverFavicons(currentUrl).then((sources) => {
			if (!cancelled) icons = { ...icons, sources };
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<span bind:this={element} class="favicon" aria-hidden="true">
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
					if (loaded && (await isBlankFavicon(loaded))) skipIcon(loaded, page);
				}}
				onerror={(event) => {
					skipIcon(event.currentTarget.getAttribute('src'), url);
				}}
			/>
		{/key}
	{:else}{letter}{/if}
</span>
