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
