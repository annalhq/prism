import { sharedStyles, type TwitterLayout } from './twitter/layout';
import { modernLayout } from './twitter/modern';
import { oldTwitterLayout } from './twitter/old-twitter';

/** Every layout runs on each pass; each one only matches its own markup. */
const layouts: TwitterLayout[] = [modernLayout, oldTwitterLayout];

export const contentMatches = ['https://x.com/*', 'https://twitter.com/*'];

/** Adds the Prism save button to posts on X/Twitter. */
export function startContent() {
	const style = document.createElement('style');
	style.dataset.prism = 'icon';
	style.textContent = [sharedStyles, ...layouts.map((layout) => layout.styles)].join('\n');

	function install() {
		// OldTwitter swaps out the whole document after load, taking our styles with it.
		if (!style.isConnected) (document.head ?? document.documentElement).append(style);
		for (const layout of layouts) layout.install();
	}
	install();
	// Observe the document node itself so the observer survives a replaced <html>/<body>.
	new MutationObserver(install).observe(document, { childList: true, subtree: true });
}
