import { prefersReducedMotion } from 'svelte/motion';
import { cubicIn } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/** A soft spring: one gentle overshoot (about 4%), settled by the end. */
const settle = (t: number) => (t === 1 ? 1 : 1 - Math.exp(-8 * t) * Math.cos(7 * t));

/**
 * A popover growing out of the control it belongs to. `from` is the side that control is on:
 * 'below' grows upward out of a bar beneath it (phones), 'above' drops down from a bar above it
 * (desktop). Entering springs in from slightly small and offset; leaving fades out quickly.
 * Only transform and opacity animate, so frosted backdrops stay smooth.
 */
export function grow(
	_node: Element,
	{ from = 'above', leaving = false }: { from?: 'above' | 'below'; leaving?: boolean } = {}
): TransitionConfig {
	if (prefersReducedMotion.current)
		return { duration: leaving ? 100 : 140, css: (t) => `opacity: ${t}` };
	const offset = from === 'below' ? 8 : -8;
	if (leaving)
		return {
			duration: 170,
			easing: cubicIn,
			css: (t, u) =>
				`opacity: ${t}; transform: translateY(${offset * 0.5 * u}px) scale(${1 - 0.02 * u})`
		};
	return {
		duration: 380,
		easing: settle,
		css: (t, u) =>
			`opacity: ${Math.min(1, t * 1.8)};` +
			`transform: translateY(${offset * u}px) scale(${0.96 + 0.04 * t})`
	};
}

/* Directional list swap. `direction` is 1 when moving right, -1 when moving left. */
export function shelfSwap(
	_node: Element,
	{ direction = 0, leaving = false }: { direction?: number; leaving?: boolean } = {}
): TransitionConfig {
	if (prefersReducedMotion.current)
		return { duration: leaving ? 0 : 120, css: (t) => `opacity: ${t}` };
	const shift = 16 * Math.sign(direction);
	if (leaving)
		return {
			duration: 140,
			easing: cubicIn,
			css: (t, u) => `opacity: ${t}; transform: translateX(${-shift * u}px)`
		};
	return {
		duration: 220,
		easing: (t) => 1 - (1 - t) ** 3,
		css: (t, u) => `opacity: ${t}; transform: translateX(${shift * u}px)`
	};
}
