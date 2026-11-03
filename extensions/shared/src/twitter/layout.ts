import type { Capture } from '../protocol';

export const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Page CSS shared by every layout's button. */
export const sharedStyles =
	'@keyframes prism-saved-pop{0%{transform:scale(1)}40%{transform:scale(1.22)}100%{transform:scale(1)}}';

/**
 * One way X/Twitter can be rendered (X's own web app, the OldTwitter extension, …).
 * Each layout owns its page styles and how it finds posts and attaches the Prism button.
 */
export interface TwitterLayout {
	readonly name: string;
	/** Page-level CSS for the injected button; scoped so it never touches other layouts. */
	readonly styles: string;
	/** Attach the Prism button to any posts that don't have one yet. Must be idempotent. */
	install(): void;
}

/** Builds a social capture from a post permalink, or nothing if the link isn't a status URL. */
export function statusCapture(link: HTMLAnchorElement | null | undefined): Capture | undefined {
	if (!link) return;
	const url = new URL(link.href, location.href);
	if (!/\/status\/\d+/.test(url.pathname)) return;
	// Social post text is useful as context, but should not become the bookmark title.
	return { title: '', url: `${url.origin}${url.pathname}`, kind: 'social' };
}

/** Flags a button as saved, restarting its pop animation when the same post is saved again. */
export function markSaved(button: HTMLElement) {
	delete button.dataset.prismSaved;
	void button.offsetWidth;
	button.dataset.prismSaved = 'true';
}

/** A 24×24 icon path, either stroked (Lucide style) or filled with the current text color. */
export function iconPath(d: string, variant: 'stroke' | 'fill') {
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', d);
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	path.setAttribute('fill', variant === 'fill' ? 'currentColor' : 'none');
	return path;
}
