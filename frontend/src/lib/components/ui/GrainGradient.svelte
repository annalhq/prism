<script lang="ts" module>
	// One gradient for the whole app: the landing and sign-in pages hand the same running shader
	// between them, so moving from one to the other never restarts it (no black frame, no fade
	// in again). It lives in a detached host element that each page's container adopts; a few
	// seconds after the last page lets go it is disposed, freeing the GPU once you're signed in.
	let host: HTMLDivElement | null = null;
	let dispose: (() => void) | null = null;
	let holders = 0;
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Paper's GrainGradient (the vanilla @paper-design/shaders build), configured exactly as the
	 * React example the pages are modelled on: white and orange in the corners, soft grainy
	 * blending, animated; still for anyone who prefers reduced motion. The host fades in only once
	 * the first frame is ready, so the page never fades to an empty black panel.
	 */
	function start(element: HTMLDivElement) {
		let stopped = false;
		let mount: { dispose: () => void } | undefined;
		void import('@paper-design/shaders').then(async (paper) => {
			if (stopped) return;
			// The grain comes from a noise image that loads on its own; the mount refuses an image
			// that isn't ready (the React wrapper waits for it too), which left the panel black.
			const noise = paper.getShaderNoiseTexture();
			if (noise && !(noise.complete && noise.naturalWidth))
				await new Promise<void>((resolve) => {
					noise.addEventListener('load', () => resolve(), { once: true });
					noise.addEventListener('error', () => resolve(), { once: true });
				});
			if (stopped) return;
			const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
			const colors = ['#FFFAF2', '#FC7819', '#FC7819', '#FFFAF2'];
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
			// Shown after the first frame has been drawn.
			requestAnimationFrame(() => requestAnimationFrame(() => (element.dataset.ready = '')));
		});
		return () => {
			stopped = true;
			mount?.dispose();
		};
	}

	function adopt(container: HTMLElement) {
		clearTimeout(releaseTimer);
		holders++;
		if (!host) {
			host = document.createElement('div');
			host.className = 'grain-host';
			dispose = start(host);
		}
		container.append(host);
	}
	function release() {
		holders--;
		releaseTimer = setTimeout(() => {
			if (holders > 0) return;
			dispose?.();
			host?.remove();
			host = null;
			dispose = null;
		}, 4000);
	}
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	let { class: className = '' }: { class?: string } = $props();
	// Adopts the shared gradient for as long as this element is on the page.
	const grain: Attachment<HTMLDivElement> = (container) => {
		adopt(container);
		return release;
	};
</script>

<div {@attach grain} class={['grain-gradient', className]} aria-hidden="true"></div>
