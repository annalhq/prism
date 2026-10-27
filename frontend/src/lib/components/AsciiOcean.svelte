<script lang="ts">
	import { onMount } from 'svelte';
	import { themePreference, type Theme } from '#lib/client/theme.svelte.js';
	import { OceanEngine } from '#lib/ocean/engine.js';
	import type { OceanPalette } from '#lib/ocean/renderer.js';
	import type { SharkSpec } from '#lib/ocean/world.js';
	let { class: className = '', sharks }: { class?: string; sharks?: SharkSpec[] } = $props();
	// Backgrounds match --canvas; the accent is orange at night and blue on paper. At night the
	// wake glows upstream's cyan; on paper it stays in the accent so it doesn't wash out.
	const palettes: Record<Theme, OceanPalette> = {
		dark: {
			background: [18, 18, 18],
			ink: [239, 238, 235],
			accent: [245, 112, 40],
			wake: [110, 230, 255]
		},
		light: { background: [247, 247, 244], ink: [38, 37, 30], accent: [37, 99, 235] }
	};
	// The bootstrap script sets data-theme before paint, ahead of themePreference.
	const palette = () =>
		palettes[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
	let canvas: HTMLCanvasElement;
	let engine: OceanEngine | undefined;
	onMount(() => {
		const ocean = new OceanEngine(canvas, sharks, palette());
		engine = ocean;
		return () => ocean.destroy();
	});
	$effect(() => {
		void themePreference.value;
		engine?.setPalette(palette());
	});
</script>

<canvas bind:this={canvas} class="ascii-ocean {className}" aria-hidden="true"></canvas>
