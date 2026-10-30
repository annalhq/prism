import { folderPath } from '../theme';
import { ease, iconPath, markSaved, statusCapture, type TwitterLayout } from './layout';
import { capturePanel } from './panel';

const shareSelector = 'button[data-testid="shareButton"], button[aria-label^="Share"]';
const statusLink = (article: HTMLElement) =>
	article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');

function replaceShareIcon(button: HTMLButtonElement) {
	const svg = button.querySelector<SVGSVGElement>('svg');
	if (!svg) return false;
	// Lucide "folder". X sizes the svg and drives currentColor.
	svg.setAttribute('viewBox', '0 0 24 24');
	// Keep X's SVG classes and surrounding color/ripple wrappers so its own hover,
	// pressed, and dark-mode styles continue to control the replacement icon.
	const group = svg.querySelector('g') ?? svg;
	group.replaceChildren(iconPath(folderPath, 'stroke'));
	return true;
}

/** X's current web app: the share button on each post becomes the Prism button. */
export const modernLayout: TwitterLayout = {
	name: 'modern',
	styles: `
button[data-prism-bookmark="true"] svg{transform-origin:50% 55%;transition:transform 180ms ${ease}}
button[data-prism-bookmark="true"]:hover svg{transform:translateY(-1px) scale(1.06)}
button[data-prism-bookmark="true"]:active svg{transform:scale(.9);transition-duration:80ms}
button[data-prism-saved="true"] svg path{fill:currentColor}
button[data-prism-saved="true"] svg{animation:prism-saved-pop 420ms ${ease}}
@media (prefers-reduced-motion:reduce){button[data-prism-bookmark="true"] svg{transition:none!important;animation:none!important;transform:none!important}}`,
	install() {
		for (const article of document.querySelectorAll<HTMLElement>('article')) {
			if (!statusLink(article)) continue;
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
					const capture = statusCapture(statusLink(article));
					if (capture) void capturePanel.open(share, capture, () => markSaved(share));
				},
				true
			);
		}
	}
};
