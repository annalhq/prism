import { browser } from 'wxt/browser';
import type { ExtensionMessage, Highlight } from '../protocol';
import { buildIndex, locate, urlHash } from './anchor';

const highlightName = 'prism-highlight';
// After a page loads, late content (lazy sections, client rendering) gets this long to appear.
const settleWindow = 15_000;

/**
 * Paints the highlights saved on this page, if it is one. Runs on every page once the user
 * turns on "Show highlights on pages". Uses the CSS Custom Highlight API, so the page's own
 * DOM is never changed. Only pages Prism lists as highlighted reach the server; everything else
 * is decided locally by URL hash.
 */
export function startHighlights() {
	if (!('highlights' in CSS) || typeof Highlight === 'undefined') return;
	const style = document.createElement('style');
	style.dataset.prism = 'highlights';
	style.textContent = `::highlight(${highlightName}){background-color:rgb(255 214 102 / 38%);color:inherit}`;

	let page = '';
	let saved: Highlight[] = [];
	let observer: MutationObserver | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let paintTimer: ReturnType<typeof setTimeout> | undefined;

	function clear() {
		saved = [];
		observer?.disconnect();
		observer = undefined;
		clearTimeout(settleTimer);
		clearTimeout(paintTimer);
		CSS.highlights.delete(highlightName);
	}

	function paint() {
		if (!saved.length || !document.body) return;
		const index = buildIndex(document.body);
		const ranges = saved.flatMap((highlight) => locate(index, highlight) ?? []);
		if (!style.isConnected) (document.head ?? document.documentElement).append(style);
		CSS.highlights.set(highlightName, new Highlight(...ranges));
	}

	async function check(force = false) {
		const href = location.href;
		if (!force && href === page) return;
		page = href;
		clear();
		if (!/^https?:/.test(href)) return;
		// Saved with or without a #fragment: either matches.
		const url = new URL(href);
		url.hash = '';
		const urlHashes = [...new Set([await urlHash(href), await urlHash(url.href)])];
		let answer: { highlights?: Highlight[] } | undefined;
		try {
			answer = await browser.runtime.sendMessage({
				type: 'highlights',
				urlHashes
			} satisfies ExtensionMessage);
		} catch {
			return; // The extension was reloaded or is waking; the next navigation tries again.
		}
		if (location.href !== href || !answer?.highlights?.length) return;
		saved = answer.highlights;
		paint();
		// Re-find passages as the page fills in, then stop watching.
		observer = new MutationObserver((records) => {
			if (records.every((record) => record.target === style || record.target === style.parentNode))
				return;
			clearTimeout(paintTimer);
			paintTimer = setTimeout(paint, 300);
		});
		observer.observe(document.body, { childList: true, subtree: true, characterData: true });
		settleTimer = setTimeout(() => {
			observer?.disconnect();
			observer = undefined;
		}, settleWindow);
	}

	void check();
	// Single-page sites change the URL without a load.
	addEventListener('popstate', () => void check());
	setInterval(() => void check(), 1000);
	// A highlight saved on this page from the context menu shows up without a reload.
	browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
		if (message?.type === 'highlights-changed') void check(true);
	});
}
