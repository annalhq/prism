<script lang="ts" module>
	import { SvelteMap } from 'svelte/reactivity';
	// Each sticker's artwork sits differently on its canvas; a square around the drawn paths
	// (measured once per sticker) keeps every icon the same visual size and centred.
	const crops = new SvelteMap<string, string>();
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import type { Sticker } from '#lib/client/stickers.svelte.js';

	let { sticker, size = 18 }: { sticker: Sticker; size?: number } = $props();

	const viewBox = $derived(crops.get(sticker.id) ?? sticker.viewBox);
	const measure: Attachment<SVGGElement> = (art) => {
		const id = sticker.id;
		if (crops.has(id)) return;
		const box = art.getBBox();
		if (!box.width || !box.height) return;
		const side = Math.max(box.width, box.height) * 1.08;
		const x = box.x + box.width / 2 - side / 2;
		const y = box.y + box.height / 2 - side / 2;
		crops.set(id, `${x.toFixed(1)} ${y.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`);
	};
</script>

<svg class="sticker" {viewBox} width={size} height={size} fill="none" aria-hidden="true">
	<g {@attach measure}>
		{#if sticker.layers?.length}
			<!-- Layers are fixed artwork painted in order (paths can repeat), so position is identity. -->
			{#each sticker.layers as layer, i (i)}<path
					d={layer.d}
					fill={layer.fill}
					fill-rule="evenodd"
				/>{/each}
		{:else}<path d={sticker.d} fill="currentColor" fill-rule="evenodd" />{/if}
	</g>
</svg>
