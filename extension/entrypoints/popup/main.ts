import { browser } from 'wxt/browser';
import { renderCaptureForm } from '../../lib/capture-form';
import { getPairingOrigin, type Capture, type ExtensionMessage } from '../../lib/protocol';
import { icons, themeCss } from '../../lib/theme';

const app = document.querySelector<HTMLElement>('#app')!;

function showMessage(title: string, detail = '') {
	const section = document.createElement('section');
	section.className = 'shell';
	const mark = document.createElement('div');
	mark.className = 'mark';
	mark.innerHTML = icons.folderLarge;
	const heading = document.createElement('h1');
	heading.textContent = title;
	section.append(mark, heading);
	if (detail) {
		const paragraph = document.createElement('p');
		paragraph.className = 'lede';
		paragraph.textContent = detail;
		section.append(paragraph);
	}
	app.replaceChildren(section);
}

async function initialize() {
	app.replaceChildren();
	const tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
	const url = tab?.url;
	if (!url || !/^https?:\/\//i.test(url)) {
		showMessage('This page cannot be saved', 'Open a regular web page and try again.');
		return;
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		showMessage('This page cannot be saved', 'The current tab does not have a valid web address.');
		return;
	}
	const isX =
		(parsed.hostname === 'x.com' ||
			parsed.hostname.endsWith('.x.com') ||
			parsed.hostname === 'twitter.com' ||
			parsed.hostname.endsWith('.twitter.com')) &&
		/\/status\/\d+/.test(parsed.pathname);
	const capture: Capture = {
		// X/Twitter tab titles often contain the post text; leave social titles for the user.
		title: isX ? '' : tab.title || parsed.hostname,
		url,
		kind: isX ? 'social' : 'page'
	};
	const connection = (await browser.runtime.sendMessage({
		type: 'connection'
	} as ExtensionMessage)) as { connected: boolean; origin?: string };
	if (!connection.connected) {
		await showPairing();
		return;
	}
	const formRoot = document.createElement('div');
	const footer = document.createElement('footer');
	footer.className = 'connection';
	footer.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="origin"></span><button type="button" class="quiet">Disconnect</button>`;
	const originLabel = footer.querySelector<HTMLElement>('.origin')!;
	if (connection.origin) {
		originLabel.textContent = new URL(connection.origin).host;
		originLabel.title = connection.origin;
	} else originLabel.textContent = 'Connected';
	footer.querySelector('button')!.addEventListener('click', async () => {
		await browser.runtime.sendMessage({ type: 'disconnect' } as ExtensionMessage);
		await initialize();
	});
	app.replaceChildren(formRoot, footer);
	await renderCaptureForm(formRoot, capture, () => window.close(), false, {
		favicon: tab.favIconUrl
	});
}

async function showPairing() {
	app.innerHTML = `
		<section class="shell">
			<div class="mark">${icons.folderLarge}</div>
			<h1>Connect to Prism</h1>
			<p class="lede">In Prism, open Account and generate a pairing code. Paste it here to start saving pages and posts.</p>
			<form id="pair-form" novalidate>
				<label class="label" for="pair-code">Pairing code</label>
				<textarea id="pair-code" rows="3" autocomplete="off" spellcheck="false" placeholder="prism1.…" required></textarea>
				<p class="origin" id="pair-origin" aria-live="polite"></p>
				<button class="primary block" type="submit"><span class="spinner" aria-hidden="true"></span><span>Connect</span></button>
				<p class="message" id="pair-message" role="status" aria-live="polite"></p>
			</form>
		</section>`;
	const form = app.querySelector<HTMLFormElement>('#pair-form')!;
	const codeInput = app.querySelector<HTMLTextAreaElement>('#pair-code')!;
	const originLabel = app.querySelector<HTMLElement>('#pair-origin')!;
	const message = app.querySelector<HTMLElement>('#pair-message')!;
	codeInput.focus();
	let origin = '';
	codeInput.addEventListener('input', () => {
		try {
			origin = getPairingOrigin(codeInput.value);
			originLabel.textContent = `Connect to ${origin}`;
			message.textContent = '';
			message.classList.remove('error');
		} catch {
			origin = '';
			originLabel.textContent = '';
		}
	});
	codeInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			form.requestSubmit();
		}
	});
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (!origin) {
			message.textContent = 'Enter a valid pairing code from Prism.';
			message.classList.add('error');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
		submit.disabled = true;
		submit.classList.add('is-busy');
		message.classList.remove('error');
		message.textContent = `Allow access to ${origin} in Firefox…`;
		try {
			const permitted = await browser.permissions.request({ origins: [`${origin}/*`] });
			if (!permitted) throw new Error('Site access was not granted. You can try again when ready.');
			const result = (await browser.runtime.sendMessage({
				type: 'pair',
				code: codeInput.value
			} as ExtensionMessage)) as { connected?: boolean; error?: string };
			if (result?.error) throw new Error(result.error);
			if (!result?.connected)
				throw new Error('Pairing did not complete. Generate a fresh code on Prism.');
			await initialize();
		} catch (error) {
			message.textContent = (error as Error).message;
			message.classList.add('error');
			submit.disabled = false;
			submit.classList.remove('is-busy');
		}
	});
}

const style = document.createElement('style');
style.textContent = `${themeCss}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{width:360px;min-height:120px;margin:0;padding:10px;background:var(--canvas);color:var(--ink);font:13px/1.45 var(--font);-webkit-font-smoothing:antialiased}
button,input,textarea{font:inherit;color:inherit}

.shell{padding:14px 10px 8px;animation:popup-rise 200ms var(--ease) both}
.mark{display:grid;place-items:center;width:34px;height:34px;margin-bottom:14px;border:1px solid var(--line);border-radius:var(--r-control);background:var(--surface);color:var(--ink)}
h1{margin:0;font-size:16px;font-weight:600;letter-spacing:-0.015em}
.lede{margin:4px 0 16px;color:var(--ink-2);font-size:12px}
.label{display:block;margin:0 0 6px;color:var(--ink-2);font-size:12px;font-weight:500}
textarea{display:block;width:100%;resize:none;padding:9px 11px;border:1px solid var(--line);border-radius:var(--r-control);background:var(--field);font:12px/1.5 var(--mono);outline:none;transition:border-color 140ms var(--ease),box-shadow 140ms var(--ease)}
textarea::placeholder{color:var(--ink-3)}
textarea:focus{border-color:color-mix(in srgb,var(--line),var(--ink) 25%);box-shadow:0 0 0 3px var(--hairline)}
.shell .origin{min-height:16px;margin:6px 0 10px;color:var(--ink-3);font-size:11px;overflow-wrap:anywhere}
.shell .message{min-height:16px;margin:8px 0 0;color:var(--ink-2);font-size:12px}
.shell .error{color:var(--danger)!important}

.shell .primary{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:0;border-radius:var(--r-control);background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;cursor:pointer;transition:transform 140ms var(--ease),opacity 140ms var(--ease)}
.shell .primary.block{width:100%}
.shell .primary:active:not(:disabled){transform:scale(.97)}
.shell .primary:disabled{cursor:default}
.shell .primary:disabled:not(.is-busy){opacity:.45}
.shell .spinner{display:none;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:popup-spin 700ms linear infinite}
.shell .is-busy .spinner{display:block}

.connection{display:flex;align-items:center;gap:7px;padding:8px 4px 0 8px;color:var(--ink-3);font-size:11px}
.dot{flex:none;width:6px;height:6px;border-radius:50%;background:#5fbf7f;box-shadow:0 0 0 3px rgb(95 191 127 / 14%)}
.connection .origin{flex:1;min-height:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.connection .quiet{height:26px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--ink-3);font-size:11px;cursor:pointer;transition:background-color 140ms var(--ease),color 140ms var(--ease)}
.connection .quiet:hover{background:var(--hover);color:var(--danger)}
button:focus-visible{outline:2px solid var(--ring);outline-offset:1px}

@keyframes popup-rise{from{opacity:0;transform:translateY(4px) scale(.98)}}
@keyframes popup-spin{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){*:not(.spinner){animation:none!important;transition:none!important}.spinner{animation-duration:1.4s!important}}
`;
document.head.append(style);
void initialize().catch((error) =>
	showMessage('Could not open Prism capture', (error as Error).message)
);
