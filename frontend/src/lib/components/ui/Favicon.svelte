<script lang="ts">
	import { Globe } from '@lucide/svelte';
	import { resolveFavicon } from '#lib/client/favicons.js';

	let { url }: { url: string | null } = $props();
	let visible = $state(false);
	let result = $state<{ url: string | null; src: string | null }>({ url: null, src: null });
	let loaded = $state<string | null>(null);
	const source = $derived(result.url === url ? result.src : null);
	const ready = $derived(!!source && loaded === source);

	function isCurrentImage(image: Element) {
		return image.isConnected && result.url === url && image.getAttribute('src') === source;
	}

	function observe(element: HTMLSpanElement) {
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
	}

	// Only external image work lives in the effect. URL-derived display state stays derived.
	$effect(() => {
		const currentUrl = url;
		if (!visible || !currentUrl) return;
		let cancelled = false;
		void resolveFavicon(currentUrl).then((src) => {
			if (!cancelled) {
				loaded = null;
				result = { url: currentUrl, src };
			}
		});
		// Shared requests may still serve another row; their own deadlines bound their lifetime.
		return () => {
			cancelled = true;
		};
	});
</script>

<span {@attach observe} class={['favicon', { fallback: !ready }]} aria-hidden="true">
	{#if !ready}<Globe />{/if}
	{#if source}
		<img
			src={source}
			alt=""
			width="16"
			height="16"
			referrerpolicy="no-referrer"
			class={{ loading: !ready }}
			onload={(event) => {
				if (isCurrentImage(event.currentTarget)) loaded = source;
			}}
			onerror={(event) => {
				if (isCurrentImage(event.currentTarget)) {
					result = { url, src: null };
					loaded = null;
				}
			}}
		/>
	{/if}
</span>

<style>
	.favicon {
		position: relative;
	}
	img.loading {
		position: absolute;
		opacity: 0;
	}
</style>
