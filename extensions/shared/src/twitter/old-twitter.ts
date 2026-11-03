import { bookmarkPath } from '../theme';
import { ease, iconPath, markSaved, statusCapture, type TwitterLayout } from './layout';
import { capturePanel } from './panel';

const button = '.tweet-interact > .tweet-interact-prism';

/** The post's own permalink, skipping any quoted post embedded in it. */
function statusLink(tweet: Element) {
	const links = tweet.querySelectorAll<HTMLAnchorElement>('a.tweet-time, a[href*="/status/"]');
	return [...links].find((link) => !link.closest('.tweet-body-quote'));
}

function createButton(tweet: Element) {
	const span = document.createElement('span');
	span.className = 'tweet-button tweet-interact-prism';
	span.title = 'Save to Prism';
	span.dataset.prismBookmark = 'true';
	span.setAttribute('role', 'button');
	span.setAttribute('tabindex', '0');
	span.setAttribute('aria-label', 'Save to Prism');
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.append(iconPath(bookmarkPath, 'fill'));
	span.append(svg);
	const open = (event: Event) => {
		event.preventDefault();
		// OldTwitter opens the post when its body is clicked; keep that from firing too.
		event.stopPropagation();
		const capture = statusCapture(statusLink(tweet));
		if (capture) void capturePanel.open(span, capture, () => markSaved(span));
	};
	span.addEventListener('click', open);
	span.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') open(event);
	});
	return span;
}

/**
 * The OldTwitter extension's classic layout: a filled bookmark sits beside the
 * favorite button, inheriting `.tweet-interact span` spacing and `--light-gray` color.
 */
export const oldTwitterLayout: TwitterLayout = {
	name: 'old-twitter',
	styles: `
${button}{line-height:1}
${button} svg{width:14px;height:14px;vertical-align:-2px;transform-origin:50% 55%;transition:transform 180ms ${ease},color 120ms}
${button}:hover,${button}:focus-visible,${button}[data-prism-saved="true"]{color:var(--link-color,#4595b5)}
${button}:hover svg{transform:translateY(-1px) scale(1.06)}
${button}:active svg{transform:scale(.9);transition-duration:80ms}
${button}[data-prism-saved="true"] svg{animation:prism-saved-pop 420ms ${ease}}
@media (prefers-reduced-motion:reduce){${button} svg{transition:none!important;animation:none!important;transform:none!important}}`,
	install() {
		for (const favorite of document.querySelectorAll('.tweet-interact > .tweet-interact-favorite')) {
			const interact = favorite.parentElement!;
			// Checked against the bar's children, so a re-rendered bar gets the button back.
			if (interact.querySelector(':scope > .tweet-interact-prism')) continue;
			const tweet = interact.closest('.tweet') ?? interact.parentElement;
			if (!tweet || !statusLink(tweet)) continue;
			favorite.after(createButton(tweet));
		}
	}
};
