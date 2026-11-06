import type { Attachment } from 'svelte/attachments';

/**
 * Grows a textarea to fit its text. Pass the bound value so the attachment re-runs when the
 * text changes from outside, such as a sync or a draft restore, not only while typing.
 */
export function autosize(value: unknown): Attachment<HTMLTextAreaElement> {
	return (node) => {
		void value;
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		node.addEventListener('input', fit);
		// A webfont arriving after the first fit changes how the text wraps.
		document.fonts?.addEventListener('loadingdone', fit);
		return () => {
			node.removeEventListener('input', fit);
			document.fonts?.removeEventListener('loadingdone', fit);
		};
	};
}

/**
 * Follows the on-screen keyboard through the visual viewport. Sets, on the node:
 *   --keyboard-inset  how much of the layout viewport's bottom the keyboard covers
 *   --visible-height  the height still visible above it
 * Fixed UI can lift by the inset to ride on top of the keyboard, as a chat input does.
 */
export const keyboardInset: Attachment<HTMLElement> = (node) => {
	const viewport = window.visualViewport;
	if (!viewport) return;
	let frame = 0;
	const measure = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
			node.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
			node.style.setProperty('--visible-height', `${Math.round(viewport.height)}px`);
		});
	};
	measure();
	viewport.addEventListener('resize', measure);
	viewport.addEventListener('scroll', measure);
	return () => {
		cancelAnimationFrame(frame);
		viewport.removeEventListener('resize', measure);
		viewport.removeEventListener('scroll', measure);
		node.style.removeProperty('--keyboard-inset');
		node.style.removeProperty('--visible-height');
	};
};
