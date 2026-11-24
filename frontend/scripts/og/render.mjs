// Run: bun run og:image
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
/** @param {string} path */
const asset = (path) => `file://${join(root, path)}`;
const TAGLINE = 'Every discovery, a beginning.';

const petals = [...readFileSync(join(root, 'static/logo.svg'), 'utf8').matchAll(/ d="([^"]+)"/g)]
	.map((match) => `<path d="${match[1]}"/>`)
	.join('');

const html = `<!doctype html>
<style>
	@font-face { font-family: Serif; src: url(${asset('static/fonts/stk-bureau-serif-book.woff2')}); }
	@font-face { font-family: Sans; src: url(${asset('static/fonts/stk-bureau-sans-book.woff2')}); }
	html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
	body { position: relative; background: #0b1622 url(${asset('scripts/og/bg.jpg')}) center / cover; }
	/* Frosted lockup: ~78% warm white, brighter at the top edge like light on glass. */
	.lockup {
		position: absolute; inset: 0 0 110px; display: flex; align-items: center; justify-content: center; gap: 30px;
		filter: drop-shadow(0 1px 0 rgb(255 255 255 / 0.25)) drop-shadow(0 10px 30px rgb(10 20 35 / 0.22));
	}
	.mark { width: 112px; height: auto; }
	.word {
		font: 400 150px/1 Serif; letter-spacing: -0.03em; padding-bottom: 14px;
		background: linear-gradient(rgb(255 250 242 / 0.84), rgb(255 250 242 / 0.72));
		-webkit-background-clip: text; background-clip: text; color: transparent;
	}
	.tagline {
		position: absolute; left: 0; right: 0; bottom: 40px; text-align: center;
		font: 400 26px/1 Sans; letter-spacing: 0.01em; color: rgb(255 250 242 / 0.72);
	}
</style>
<div class="lockup">
	<svg class="mark" viewBox="0 0 263 252">
		<defs><linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#fffaf2" stop-opacity="0.84"/>
			<stop offset="1" stop-color="#fffaf2" stop-opacity="0.72"/>
		</linearGradient></defs>
		<g fill="url(#glass)">${petals}</g>
	</svg>
	<span class="word">prism</span>
</div>
<p class="tagline">${TAGLINE}</p>`;

const work = mkdtempSync(join(tmpdir(), 'prism-og-'));
try {
	const page_ = join(work, 'og.html');
	const png = join(work, 'og.png');
	writeFileSync(page_, html);
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	await page.goto(`file://${page_}`);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: png });
	await browser.close();
	const out = join(root, 'static/og-image.jpg');
	execFileSync('magick', [
		png,
		'-strip',
		'-interlace',
		'Plane',
		'-sampling-factor',
		'4:2:0',
		'-quality',
		'82',
		out
	]);
	console.log(`static/og-image.jpg ${Math.round(statSync(out).size / 1024)} KB`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
