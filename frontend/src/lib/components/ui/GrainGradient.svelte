<script lang="ts">
	import { onMount } from 'svelte';

	// Paper's GrainGradient shader (the vanilla @paper-design/shaders build), configured exactly
	// as the React example the landing and sign-in pages are modelled on: white and orange in the
	// corners, soft grainy blending, animated. It renders on a WebGL canvas the mount sizes to
	// this element, pauses itself off-screen or in a hidden tab, and stays still for anyone who
	// prefers reduced motion. Loaded only in the browser, so server rendering never touches WebGL.
	let { class: className = '' }: { class?: string } = $props();
	let element: HTMLDivElement;

	onMount(() => {
		let disposed = false;
		let mount: { dispose: () => void } | undefined;
		void import('@paper-design/shaders').then(async (paper) => {
			if (disposed) return;
			// The grain comes from a noise image that loads on its own; the mount refuses an image
			// that isn't ready (the React wrapper waits for it too), which left the panel black.
			const noise = paper.getShaderNoiseTexture();
			if (noise && !(noise.complete && noise.naturalWidth))
				await new Promise<void>((resolve) => {
					noise.addEventListener('load', () => resolve(), { once: true });
					noise.addEventListener('error', () => resolve(), { once: true });
				});
			if (disposed) return;
			const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
			const colors = ['#FFFFFF', '#FC7819', '#FC7819', '#FFFFFF'];
			mount = new paper.ShaderMount(
				element,
				paper.grainGradientFragmentShader,
				{
					u_colorBack: paper.getShaderColorFromString('#00000000'),
					u_colors: colors.map(paper.getShaderColorFromString),
					u_colorsCount: colors.length,
					u_softness: 0.5,
					u_intensity: 0.5,
					u_noise: 0.25,
					u_shape: paper.GrainGradientShapes.corners,
					u_noiseTexture: noise,
					u_fit: paper.ShaderFitOptions[paper.defaultObjectSizing.fit],
					u_scale: 1,
					u_rotation: 0,
					u_offsetX: 0,
					u_offsetY: 0,
					u_originX: paper.defaultObjectSizing.originX,
					u_originY: paper.defaultObjectSizing.originY,
					u_worldWidth: paper.defaultObjectSizing.worldWidth,
					u_worldHeight: paper.defaultObjectSizing.worldHeight
				},
				undefined,
				still ? 0 : 1,
				2854.5
			);
		});
		return () => {
			disposed = true;
			mount?.dispose();
		};
	});
</script>

<div bind:this={element} class="grain-gradient {className}" aria-hidden="true"></div>
