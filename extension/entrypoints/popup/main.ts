import { browser } from 'wxt/browser';
import { renderCaptureForm } from '../../lib/capture-form';
import { getPairingOrigin, type Capture, type ExtensionMessage } from '../../lib/protocol';

const app = document.querySelector<HTMLElement>('#app')!;

function showMessage(title: string, detail = '') {
	const section = document.createElement('section');
	section.className = 'shell';
	const heading = document.createElement('h1');
	heading.textContent = title;
	section.append(heading);
	if (detail) {
		const paragraph = document.createElement('p');
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
	await renderCaptureForm(app, capture, () => window.close());
}

async function showPairing() {
	app.innerHTML = `
		<section class="shell">
			<div class="brand">P</div>
			<h1>Connect Prism</h1>
			<p>Generate a one-time code from Prism’s Account panel, then enter it here.</p>
			<form id="pair-form">
				<label for="pair-code">Pairing code</label>
				<textarea id="pair-code" rows="3" autocomplete="off" required></textarea>
				<p class="origin" id="pair-origin" aria-live="polite"></p>
				<p class="message" id="pair-message" role="status" aria-live="polite"></p>
				<button class="primary" type="submit">Connect extension</button>
			</form>
		</section>`;
	const form = app.querySelector<HTMLFormElement>('#pair-form')!;
	const codeInput = app.querySelector<HTMLTextAreaElement>('#pair-code')!;
	const originLabel = app.querySelector<HTMLElement>('#pair-origin')!;
	const message = app.querySelector<HTMLElement>('#pair-message')!;
	let origin = '';
	codeInput.addEventListener('input', () => {
		try {
			origin = getPairingOrigin(codeInput.value);
			originLabel.textContent = `Connect to ${origin}`;
			message.textContent = '';
		} catch {
			origin = '';
			originLabel.textContent = '';
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
		}
	});
}

const style = document.createElement('style');
style.textContent = `
*{box-sizing:border-box}body{width:360px;min-height:180px;margin:0;background:#121212;color:#efeeeb;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
.shell{padding:20px}.brand{display:grid;place-items:center;width:30px;height:30px;margin-bottom:12px;border:1px solid #323232;border-radius:10px;color:#f5f5f7;font-weight:700}
h1{margin:0;font-size:17px;letter-spacing:-.02em}p{color:#aaa9a5;font-size:12px}.shell>p{margin:5px 0 16px}label{display:block;margin-bottom:5px;color:#aaa9a5;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
textarea{width:100%;resize:vertical;padding:9px;border:1px solid #323232;border-radius:9px;background:#202020;color:#efeeeb;font:12px/1.5 ui-monospace,monospace}
button{min-height:38px;padding:0 14px;border:1px solid #323232;border-radius:9px;background:#1a1a1a;color:#efeeeb;font:inherit;cursor:pointer}.primary{border-color:#f5f5f7;background:#f5f5f7;color:#161618;font-weight:600}button:disabled{opacity:.5;cursor:default}
.origin{min-height:18px;margin:8px 0}.message{min-height:18px;margin:0 0 10px}.error{color:#f2a6a0!important}
`;
document.head.append(style);
void initialize().catch((error) =>
	showMessage('Could not open Prism capture', (error as Error).message)
);
