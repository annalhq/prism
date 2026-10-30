import { sharedStyles, type TwitterLayout } from '../lib/twitter/layout';
import { modernLayout } from '../lib/twitter/modern';
import { oldTwitterLayout } from '../lib/twitter/old-twitter';

/** Every layout runs on each pass; each one only matches its own markup. */
const layouts: TwitterLayout[] = [modernLayout, oldTwitterLayout];

export default defineContentScript({
	matches: ['https://x.com/*', 'https://twitter.com/*'],
	runAt: 'document_idle',
	main() {
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
});
