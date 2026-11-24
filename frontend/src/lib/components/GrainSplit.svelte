<script lang="ts" module>
	// The landing's opening plays once per visit: only when the landing is the first page shown,
	// never again on coming back to it from sign-in. Set on mount, so the server always renders
	// the opening and the first paint already has it.
	let introduced = false;
</script>

<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
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
	// Decided once, as the page is made: a flower blooms mid-screen, then dissolves into the page.
	const intro = untrack(() => landing) && !introduced;
	// The opening flower leaves the page once it has faded out.
	let bloomed = $state(false);
	onMount(() => {
		introduced = true;
	});
</script>

<div class="grain-page" class:grain-landing={landing} class:grain-intro={intro}>
	<main {id} class="grain-card" tabindex="-1">{@render children()}</main>
	<aside class="grain-panel" aria-hidden="true">
		<GrainGradient class="grain-canvas" />
		{#if intro && !bloomed}<span
				class="grain-bloom"
				onanimationend={(event) => {
					if (event.target === event.currentTarget) bloomed = true;
				}}><Brand bloom /></span
			>{/if}
		<div class="grain-panel-copy">
			<span class="grain-brand"><Brand /></span>
			{@render panel?.()}
		</div>
	</aside>
</div>
