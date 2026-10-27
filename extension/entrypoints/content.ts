import { browser } from 'wxt/browser';
import { renderCaptureForm } from '../lib/capture-form';
import type { Capture } from '../lib/protocol';
import { folderPath } from '../lib/theme';

export default defineContentScript({
	matches: ['https://x.com/*', 'https://twitter.com/*'],
	runAt: 'document_idle',
	main() {
		const shareSelector = 'button[data-testid="shareButton"], button[aria-label^="Share"]';
		const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
		let activeHost: HTMLElement | undefined;
		let activeButton: HTMLButtonElement | undefined;
		let resizeObserver: ResizeObserver | undefined;
		const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

		// Page-level styles for the injected icon: X's own wrappers keep handling color and ripple.
		const iconStyle = document.createElement('style');
		iconStyle.dataset.prism = 'icon';
		iconStyle.textContent = `
button[data-prism-bookmark="true"] svg{transform-origin:50% 55%;transition:transform 180ms ${ease}}
button[data-prism-bookmark="true"]:hover svg{transform:translateY(-1px) scale(1.06)}
button[data-prism-bookmark="true"]:active svg{transform:scale(.9);transition-duration:80ms}
button[data-prism-saved="true"] svg path{fill:currentColor}
button[data-prism-saved="true"] svg{animation:prism-saved-pop 420ms ${ease}}
@keyframes prism-saved-pop{0%{transform:scale(1)}40%{transform:scale(1.22)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){button[data-prism-bookmark="true"] svg{transition:none!important;animation:none!important;transform:none!important}}`;
		(document.head ?? document.documentElement).append(iconStyle);

		function closePanel() {
			const host = activeHost;
			host?.shadowRoot?.dispatchEvent(new CustomEvent('prism-dispose'));
			activeHost = undefined;
			activeButton = undefined;
			resizeObserver?.disconnect();
			resizeObserver = undefined;
			document.removeEventListener('pointerdown', onOutsideClick, true);
			document.removeEventListener('keydown', onEscape, true);
			window.removeEventListener('scroll', placePanel, true);
			window.removeEventListener('resize', placePanel);
			if (!host) return;
			host.style.pointerEvents = 'none';
			const exit = host.animate(
				reducedMotion()
					? [{ opacity: 1 }, { opacity: 0 }]
					: [
							{ opacity: 1, transform: 'none' },
							{ opacity: 0, transform: 'translateY(2px) scale(0.98)' }
						],
				{ duration: 140, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
			);
			exit.finished.then(
				() => host.remove(),
				() => host.remove()
			);
		}
		function onOutsideClick(event: PointerEvent) {
			if (activeHost && event.target instanceof Node && !activeHost.contains(event.target))
				closePanel();
		}
		function onEscape(event: KeyboardEvent) {
			if (event.key !== 'Escape' || !activeHost) return;
			// Inside the panel, the form decides: the first Escape clears token text, the next closes.
			if (event.composedPath().includes(activeHost)) return;
			closePanel();
		}
		function placePanel() {
			if (!activeHost || !activeButton) return;
			const rect = activeButton.getBoundingClientRect();
			const width = Math.min(360, window.innerWidth - 20);
			const height = activeHost.getBoundingClientRect().height;
			activeHost.style.width = `${width}px`;
			activeHost.style.left = `${Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10))}px`;
			activeHost.style.top = `${Math.max(10, Math.min(rect.bottom + 8, window.innerHeight - height - 10))}px`;
		}
		function markSaved(button: HTMLButtonElement) {
			delete button.dataset.prismSaved;
			void button.offsetWidth; // Restart the pop animation when saving the same post again.
			button.dataset.prismSaved = 'true';
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
			const light = matchMedia('(prefers-color-scheme: light)').matches;
			const host = document.createElement('div');
			host.dataset.prismPopover = 'true';
			host.style.cssText = `position:fixed;z-index:2147483647;max-height:calc(100vh - 20px);overflow:auto;border-radius:14px;transform-origin:top right;filter:${
				light
					? 'drop-shadow(0 10px 24px rgb(38 37 30 / 12%)) drop-shadow(0 1px 3px rgb(38 37 30 / 8%))'
					: 'drop-shadow(0 14px 32px rgb(0 0 0 / 45%)) drop-shadow(0 1px 3px rgb(0 0 0 / 30%))'
			}`;
			const shadow = host.attachShadow({ mode: 'open' });
			// Keep X's keyboard shortcuts from reacting to typing inside the panel.
			for (const type of ['keydown', 'keyup', 'keypress'])
				host.addEventListener(type, (event) => event.stopPropagation());
			document.body.append(host);
			activeHost = host;
			activeButton = button;
			placePanel();
			host.animate(
				reducedMotion()
					? [{ opacity: 0 }, { opacity: 1 }]
					: [
							{ opacity: 0, transform: 'translateY(4px) scale(0.98)' },
							{ opacity: 1, transform: 'none' }
						],
				{ duration: 200, easing: ease }
			);
			shadow.addEventListener('prism-close', closePanel);
			shadow.addEventListener('prism-saved', () => markSaved(button));
			document.addEventListener('pointerdown', onOutsideClick, true);
			document.addEventListener('keydown', onEscape, true);
			window.addEventListener('scroll', placePanel, true);
			window.addEventListener('resize', placePanel);
			resizeObserver = new ResizeObserver(() => placePanel());
			resizeObserver.observe(host);
			try {
				await renderCaptureForm(shadow, capture, closePanel, true);
				placePanel();
			} catch (error) {
				const status = document.createElement('p');
				status.textContent = (error as Error).message;
				status.style.cssText = `margin:0;padding:14px 16px;border:1px solid ${light ? '#26251e1a' : '#303030'};border-radius:14px;background:${light ? '#fbfbf9' : '#1a1a1a'};color:${light ? '#cf2d56' : '#f2a6a0'};font:13px/1.45 system-ui,sans-serif`;
				shadow.append(status);
			}
		}
		function replaceShareIcon(button: HTMLButtonElement) {
			const svg = button.querySelector<SVGSVGElement>('svg');
			if (!svg) return false;
			// Lucide "folder". Stroked rather than filled; X sizes the svg and drives currentColor.
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', folderPath);
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', 'currentColor');
			path.setAttribute('stroke-width', '2');
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('stroke-linejoin', 'round');
			svg.setAttribute('viewBox', '0 0 24 24');
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
