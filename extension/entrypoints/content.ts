import { browser } from 'wxt/browser';
import { renderCaptureForm } from '../lib/capture-form';
import type { Capture } from '../lib/protocol';

export default defineContentScript({
	matches: ['https://x.com/*', 'https://twitter.com/*'],
	runAt: 'document_idle',
	main() {
		const shareSelector = 'button[data-testid="shareButton"], button[aria-label^="Share"]';
		let activeHost: HTMLElement | undefined;
		let activeButton: HTMLButtonElement | undefined;

		function closePanel() {
			activeHost?.shadowRoot?.dispatchEvent(new CustomEvent('prism-dispose'));
			activeHost?.remove();
			activeHost = undefined;
			activeButton = undefined;
			document.removeEventListener('pointerdown', onOutsideClick, true);
			document.removeEventListener('keydown', onEscape, true);
			window.removeEventListener('scroll', placePanel, true);
			window.removeEventListener('resize', placePanel);
		}
		function onOutsideClick(event: PointerEvent) {
			if (activeHost && event.target instanceof Node && !activeHost.contains(event.target))
				closePanel();
		}
		function onEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') closePanel();
		}
		function placePanel() {
			if (!activeHost || !activeButton) return;
			const rect = activeButton.getBoundingClientRect();
			const width = Math.min(340, window.innerWidth - 20);
			const height = activeHost.getBoundingClientRect().height;
			activeHost.style.width = `${width}px`;
			activeHost.style.left = `${Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10))}px`;
			activeHost.style.top = `${Math.max(10, Math.min(rect.bottom + 8, window.innerHeight - height - 10))}px`;
		}
		async function openPanel(button: HTMLButtonElement, article: HTMLElement) {
			closePanel();
			const statusLink = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
			if (!statusLink) return;
			const targetUrl = new URL(statusLink.href, location.href);
			if (!/\/status\/\d+/.test(targetUrl.pathname)) return;
			const capture: Capture = {
				// Social post text is useful as context, but should not become the bookmark title.
				title: '',
				url: `${targetUrl.origin}${targetUrl.pathname}`,
				kind: 'social'
			};
			const host = document.createElement('div');
			host.dataset.prismPopover = 'true';
			host.style.cssText =
				'position:fixed;z-index:2147483647;max-height:calc(100vh - 20px);overflow:auto;filter:drop-shadow(0 12px 32px #0009)';
			const shadow = host.attachShadow({ mode: 'open' });
			document.body.append(host);
			activeHost = host;
			activeButton = button;
			placePanel();
			shadow.addEventListener('prism-close', closePanel);
			document.addEventListener('pointerdown', onOutsideClick, true);
			document.addEventListener('keydown', onEscape, true);
			window.addEventListener('scroll', placePanel, true);
			window.addEventListener('resize', placePanel);
			try {
				await renderCaptureForm(shadow, capture, closePanel, true);
				placePanel();
			} catch (error) {
				const status = document.createElement('p');
				status.textContent = (error as Error).message;
				status.style.cssText = 'padding:16px;background:#121212;color:#f2a6a0;font:13px system-ui';
				shadow.append(status);
			}
		}
		function replaceShareIcon(button: HTMLButtonElement) {
			const svg = button.querySelector<SVGSVGElement>('svg');
			if (!svg) return false;
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute(
				'd',
				'M17 3H7a2 2 0 0 0-2 2v16l7-4 7 4V5a2 2 0 0 0-2-2zm0 14.53-5-2.86-5 2.86V5h10v12.53z'
			);
			// Keep X's SVG classes and surrounding color/ripple wrappers so its own hover,
			// pressed, and dark-mode styles continue to control the replacement icon.
			const group = svg.querySelector('g') ?? svg;
			group.replaceChildren(path);
			return true;
		}
		function installButtons() {
			for (const article of document.querySelectorAll<HTMLElement>('article')) {
				if (!article.querySelector('a[href*="/status/"]')) continue;
				const share = article.querySelector<HTMLButtonElement>(shareSelector);
				if (!share || share.dataset.prismBookmark === 'true') continue;
				if (!replaceShareIcon(share)) continue;
				share.dataset.prismBookmark = 'true';
				share.setAttribute('aria-label', 'Save to Prism');
				share.removeAttribute('aria-haspopup');
				share.removeAttribute('aria-expanded');
				share.addEventListener(
					'click',
					(event) => {
						event.preventDefault();
						event.stopImmediatePropagation();
						void openPanel(share, article);
					},
					true
				);
			}
		}
		installButtons();
		const observer = new MutationObserver(installButtons);
		observer.observe(document.body, { childList: true, subtree: true });
	}
});
