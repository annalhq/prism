<script lang="ts">
	import type { Snippet } from 'svelte';
	import GrainGradient from './ui/GrainGradient.svelte';
	import Brand from './ui/Brand.svelte';
	// The landing and sign-in pages: the animated grain gradient fills the window, the Prism mark
	// rests on it, and the page floats over it in glass. `landing` is just the headline and the
	// way in, low on the screen; sign-in is the form in a smoky glass card.
	let {
		id,
		children,
		panel,
		landing = false
	}: { id: string; children: Snippet; panel?: Snippet; landing?: boolean } = $props();
</script>

<div class="grain-page" class:grain-landing={landing}>
	<main {id} class="grain-card" tabindex="-1">{@render children()}</main>
	<aside class="grain-panel" aria-hidden="true">
		<GrainGradient class="grain-canvas" />
		<div class="grain-panel-copy">
			<span class="grain-brand"><Brand /></span>
			{@render panel?.()}
		</div>
	</aside>
</div>
