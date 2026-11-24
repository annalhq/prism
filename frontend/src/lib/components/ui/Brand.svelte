<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ClassValue } from 'svelte/elements';

	let {
		compact = false,
		home = '/',
		labelClass,
		bloom = false
	}: {
		// The mark alone, without the wordmark.
		compact?: boolean;
		home?: '/' | '/public';
		// Extra classes for the wordmark, such as the sidebar's fading label.
		labelClass?: ClassValue;
		// The flower alone, for show (the landing's opening): not a link and no wordmark. Once it
		// has opened it breathes out, relaxing fully open, for the page to fade it away.
		bloom?: boolean;
	} = $props();

	// The mark's five petals (static/logo.svg), drawn inline so each can move on its own. They
	// run clockwise from the top one, 72° apart around the flower's centre: a petal's place in
	// this list is both its angle and its turn to open.
	const PETALS = [
		'M143.404 115.886C137.806 124.137 125.622 124.056 120.132 115.732L85.6075 63.3779C76.7038 49.876 80.1057 31.7465 93.2985 22.3909L120.196 3.31712C126.428 -1.1029 134.773 -1.10601 141.009 3.30938L170.226 23.9958C183.559 33.4357 186.888 51.808 177.715 65.3256L143.404 115.886Z',
		'M155.726 142.646C146.149 139.871 142.461 128.258 148.681 120.466L187.804 71.4521C197.894 58.8118 216.188 56.4448 229.162 66.1009L255.614 85.7874C261.744 90.3494 264.325 98.2844 262.053 105.58L251.408 139.759C246.55 155.357 230.105 164.2 214.415 159.653L155.726 142.646Z',
		'M133.079 159.806C132.95 149.836 142.988 142.93 152.253 146.616L210.525 169.796C225.553 175.774 233.137 192.589 227.67 207.811L216.526 238.844C213.944 246.035 207.102 250.813 199.461 250.76L163.663 250.513C147.327 250.401 134.085 237.238 133.872 220.903L133.079 159.806Z',
		'M109.654 146.532C119.096 143.328 128.766 150.741 128.123 160.691L124.084 223.274C123.043 239.413 109.394 251.822 93.2286 251.327L60.2704 250.318C52.6329 250.085 45.9754 245.054 43.6643 237.771L32.8367 203.649C27.8957 188.078 36.3217 171.416 51.7915 166.166L109.654 146.532Z',
		'M115.051 118.12C121.167 125.995 117.326 137.557 107.713 140.206L47.2524 156.862C31.6599 161.158 15.4689 152.32 10.648 136.882L0.819439 105.408C-1.45817 98.1138 1.11742 90.1769 7.2438 85.6103L35.9463 64.2156C49.0442 54.4526 67.546 56.964 77.5674 69.8653L115.051 118.12Z'
	] as const;
</script>

{#snippet mark()}<span class="brand-symbol" aria-hidden="true"
		><svg class="brand-mark" viewBox="0 0 263 252" fill="currentColor"
			>{#each PETALS as d, order (order)}<path
					class="brand-petal"
					style:--order={order}
					{d}
				/>{/each}</svg
		></span
	>{/snippet}

{#if bloom}<span class="brand brand-bloom" aria-hidden="true">{@render mark()}</span>{:else}<a
		class={['brand', compact && 'compact-brand']}
		href={resolve(home)}
		aria-label="Prism home"
		>{@render mark()}{#if !compact}<span class={['brand-word', labelClass]}>prism</span>{/if}</a
	>{/if}

<style>
	/* How far a petal has relaxed open (0 at rest, 1 fully relaxed, below 0 tucked in), and where
	   it is in its slow breath (-1 to 1). Registered as numbers so they can ease and animate. */
	@property --petal-relax {
		syntax: '<number>';
		inherits: true;
		initial-value: 0;
	}
	@property --petal-breath {
		syntax: '<number>';
		inherits: true;
		initial-value: 0;
	}
	.brand {
		-webkit-tap-highlight-color: transparent;
	}
	.brand:focus-visible {
		outline: 2px solid var(--line);
		outline-offset: 3px;
		border-radius: var(--radius-control);
	}
	.brand-symbol {
		flex-shrink: 0;
	}
	/* Sized by height; the width follows the mark's own proportions (263 × 252). */
	.brand-mark {
		display: block;
		width: auto;
		height: var(--brand-mark, 22px);
		aspect-ratio: 263 / 252;
		overflow: visible;
	}
	/*
	 * Each petal is moved in its own frame: turned to point straight up, changed there (x is its
	 * width, y its length, up is away from the centre), then turned back. So a petal can lengthen,
	 * broaden or drift outward along its own axis, whichever way it faces.
	 * At rest every term is zero. Relaxed, it lies a little further out, longer and broader, and
	 * breathes: its length and lean rise and fall slowly, scaled by how relaxed it is, so the
	 * breath fades in and out with the hover instead of starting or stopping.
	 */
	.brand-petal {
		--a: calc(var(--order) * 72deg);
		transform-box: view-box;
		transform-origin: 131.5px 137px;
		transform: rotate(calc(var(--a) + var(--petal-relax) * var(--petal-breath) * 2deg))
			translateY(calc(var(--petal-relax) * -13px))
			scale(
				calc(1 + var(--petal-relax) * 0.05),
				calc(1 + var(--petal-relax) * (0.05 + var(--petal-breath) * 0.035))
			)
			rotate(calc(var(--a) * -1));
	}
	@media (prefers-reduced-motion: no-preference) {
		/* On arrival the flower blooms from a bud: the petals start small, short and wound around
		   the centre, as if still closed and pointing up at you. The bud swells, then they unwind
		   and lay themselves open almost together, each a beat after the one before, a touch past
		   flat before settling. Filling only backwards hands each petal back to the rule above
		   once it has opened. */
		.brand-petal {
			animation:
				petal-bloom 1400ms backwards,
				petal-breath 3200ms ease-in-out infinite alternate paused;
			animation-delay: calc(140ms + var(--order) * 45ms), calc(var(--order) * -1300ms);
			transition: --petal-relax 900ms cubic-bezier(0.33, 0, 0.15, 1);
			/* The relaxing passes around the flower rather than landing on every petal at once. */
			transition-delay: calc(var(--order) * 45ms);
		}
		/* The opening flower: after it has bloomed it breathes out, each petal relaxing fully open
		   a beat after the last and breathing on, while the page fades it away. */
		.brand-bloom .brand-petal {
			animation:
				petal-bloom 1400ms backwards,
				petal-breath 3200ms ease-in-out infinite alternate,
				petal-exhale 1700ms cubic-bezier(0.4, 0, 0.2, 1) both;
			animation-delay:
				calc(140ms + var(--order) * 45ms), calc(var(--order) * -1300ms),
				calc(1750ms + var(--order) * 50ms);
		}
		/* Pointed at (or focused), the petals relax open and breathe; leaving, they draw back in
		   and the breath stills where it is. */
		@media (hover: hover) {
			.brand:hover .brand-petal {
				--petal-relax: 1;
				animation-play-state: running, running;
			}
		}
		.brand:focus-visible .brand-petal {
			--petal-relax: 1;
			animation-play-state: running, running;
		}
		/* Pressed, the flower tucks in a touch, quickly, and reopens on release. */
		.brand:active .brand-petal {
			--petal-relax: -0.3;
			transition-duration: 180ms;
			transition-delay: 0ms;
		}
	}
	@keyframes petal-bloom {
		0% {
			opacity: 0;
			transform: rotate(calc(var(--a) - 58deg)) translateY(0) scale(0.42, 0.2)
				rotate(calc(var(--a) * -1));
			animation-timing-function: ease-out;
		}
		/* The bud: closed, wound around the centre, swelling a little before it gives. */
		20% {
			opacity: 1;
			transform: rotate(calc(var(--a) - 52deg)) translateY(0) scale(0.5, 0.3)
				rotate(calc(var(--a) * -1));
			animation-timing-function: cubic-bezier(0.45, 0, 0.15, 1);
		}
		72% {
			transform: rotate(calc(var(--a) + 2.5deg)) translateY(-5px) scale(1.03, 1.06)
				rotate(calc(var(--a) * -1));
			animation-timing-function: cubic-bezier(0.4, 0, 0.3, 1);
		}
		100% {
			opacity: 1;
			transform: rotate(var(--a)) translateY(0) scale(1, 1) rotate(calc(var(--a) * -1));
		}
	}
	@keyframes petal-exhale {
		from {
			--petal-relax: 0;
		}
		to {
			--petal-relax: 1;
		}
	}
	@keyframes petal-breath {
		from {
			--petal-breath: -1;
		}
		to {
			--petal-breath: 1;
		}
	}
</style>
