import { browser } from 'wxt/browser';
import { renderCaptureForm } from './capture-form';
import {
	getPairingOrigin,
	highlightOrigins,
	showHighlightsKey,
	type Capture,
	type ConnectionInfo,
	type ExtensionMessage,
	type Highlight
} from './protocol';
import { browserName } from './platform';
import { cornersKey, followLook, icons, themeCss } from './theme';

let app: HTMLElement;

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
	} as ExtensionMessage)) as ConnectionInfo;
	if (!connection.connected) {
		await showPairing();
		return;
	}
	// A selection sent here by the context menu's "Add to Prism".
	if (tab.id !== undefined) {
		const { selection } = ((await browser.runtime.sendMessage({
			type: 'take-highlight',
			tabId: tab.id
		} as ExtensionMessage)) ?? {}) as {
			selection?: { description: string; highlight?: Highlight } | null;
		};
		if (selection?.description) {
			capture.description = selection.description;
			capture.highlight = selection.highlight;
		}
	}
	const formRoot = document.createElement('div');
	const footer = document.createElement('footer');
	footer.className = 'connection';
	footer.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="origin"></span><button type="button" class="icon-button" aria-label="Settings" title="Settings">${icons.settings}</button>`;
	const originLabel = footer.querySelector<HTMLElement>('.origin')!;
	const host = new URL(connection.origin).host;
	originLabel.textContent = connection.name ? `${connection.name} · ${host}` : host;
	originLabel.title = connection.origin;
	footer.querySelector('button')!.addEventListener('click', () => {
		formRoot.hidden = true;
		footer.hidden = true;
		showSettings(connection, () => {
			formRoot.hidden = false;
			footer.hidden = false;
		});
	});
	app.replaceChildren(formRoot, footer);
	await renderCaptureForm(formRoot, capture, () => window.close(), false, {
		favicon: tab.favIconUrl,
		tabId: tab.id
	});
}

/** What a newly paired browser is called until the user names it, e.g. "Chrome on macOS". */
function suggestedName() {
	const platform =
		(navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
		navigator.platform ||
		'';
	const os = /android/i.test(navigator.userAgent)
		? 'Android'
		: /mac|iphone|ipad/i.test(platform)
			? 'macOS'
			: /win/i.test(platform)
				? 'Windows'
				: /cros|chrome ?os/i.test(platform + navigator.userAgent)
					? 'ChromeOS'
					: /linux/i.test(platform)
						? 'Linux'
						: '';
	return os ? `${browserName} on ${os}` : browserName;
}

/**
 * The connection's settings, over the capture form: its name in Prism, square corners, painting
 * saved highlights on pages, and disconnecting. `onBack` shows the form again as it was left.
 */
function showSettings(
	connection: Extract<ConnectionInfo, { connected: true }>,
	onBack: () => void
) {
	const section = document.createElement('section');
	section.className = 'shell settings';
	section.innerHTML = `
		<header class="settings-head">
			<button type="button" class="icon-button back" aria-label="Back to save" title="Back">${icons.back}</button>
			<h2>Settings</h2>
		</header>
		<label class="label" for="connection-name">Name</label>
		<input id="connection-name" class="field" maxlength="60" autocomplete="off" spellcheck="false" />
		<p class="hint-text">How this browser appears in Prism’s Account panel.</p>
		<div class="rows">
			<div class="row">
				<span class="row-text"><strong id="corners-label">Square corners</strong><small>A stricter look for this extension.</small></span>
				<button type="button" class="switch" role="switch" aria-labelledby="corners-label" data-setting="corners"></button>
			</div>
			<div class="row">
				<span class="row-text"><strong id="highlights-label">Show highlights on pages</strong><small>Marks passages you saved when you visit a page again. Needs access to sites.</small></span>
				<button type="button" class="switch" role="switch" aria-labelledby="highlights-label" data-setting="highlights"></button>
			</div>
			<div class="row">
				<span class="row-text"><strong>Connected</strong><small class="origin-text"></small></span>
				<button type="button" class="quiet danger" data-disconnect>Disconnect</button>
			</div>
		</div>
		<p class="message" role="status" aria-live="polite"></p>`;
	app.append(section);
	const nameInput = section.querySelector<HTMLInputElement>('#connection-name')!;
	const message = section.querySelector<HTMLElement>('.message')!;
	const corners = section.querySelector<HTMLButtonElement>('[data-setting="corners"]')!;
	const highlights = section.querySelector<HTMLButtonElement>('[data-setting="highlights"]')!;
	section.querySelector<HTMLElement>('.origin-text')!.textContent = new URL(connection.origin).host;
	const say = (text: string, error = false) => {
		message.textContent = text;
		message.classList.toggle('error', error);
	};
	const setSwitch = (button: HTMLButtonElement, on: boolean) =>
		button.setAttribute('aria-checked', String(on));

	section.querySelector('.back')!.addEventListener('click', () => {
		section.remove();
		onBack();
	});

	let savedName = connection.name ?? '';
	nameInput.value = savedName;
	nameInput.placeholder = suggestedName();
	async function rename() {
		const name = nameInput.value.trim().replace(/\s+/g, ' ');
		if (!name || name === savedName) {
			nameInput.value = savedName;
			return;
		}
		say('Saving…');
		const result = (await browser.runtime.sendMessage({
			type: 'rename',
			name
		} as ExtensionMessage)) as { name?: string; error?: string };
		if (result?.error || !result?.name) {
			say(result?.error ?? 'Could not rename this browser.', true);
			nameInput.value = savedName;
			return;
		}
		savedName = connection.name = nameInput.value = result.name;
		const host = new URL(connection.origin).host;
		const footerLabel = app.querySelector<HTMLElement>('.connection .origin');
		if (footerLabel) footerLabel.textContent = `${result.name} · ${host}`;
		say('Renamed.');
	}
	nameInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			nameInput.blur();
		}
	});
	nameInput.addEventListener('change', () => void rename());

	void browser.storage.local.get([cornersKey, showHighlightsKey]).then(async (stored) => {
		setSwitch(corners, stored[cornersKey] === true);
		setSwitch(
			highlights,
			stored[showHighlightsKey] === true &&
				(await browser.permissions.contains({ origins: highlightOrigins }))
		);
	});
	corners.addEventListener('click', async () => {
		const on = corners.getAttribute('aria-checked') !== 'true';
		setSwitch(corners, on);
		await browser.storage.local.set({ [cornersKey]: on });
	});
	highlights.addEventListener('click', async () => {
		const on = highlights.getAttribute('aria-checked') !== 'true';
		say('');
		try {
			// Asked first, while the click still counts as the user's.
			if (on && !(await browser.permissions.request({ origins: highlightOrigins }))) {
				say('Site access was not granted, so highlights stay hidden.', true);
				return;
			}
			const result = (await browser.runtime.sendMessage({
				type: 'set-show-highlights',
				enabled: on
			} as ExtensionMessage)) as { error?: string };
			if (result?.error) throw new Error(result.error);
			setSwitch(highlights, on);
			if (on) say('Highlights show on pages you open or reload from now.');
		} catch (error) {
			say((error as Error).message, true);
		}
	});

	section.querySelector('[data-disconnect]')!.addEventListener('click', async () => {
		await browser.runtime.sendMessage({ type: 'disconnect' } as ExtensionMessage);
		await initialize();
	});
	nameInput.focus();
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
	const nameInput = app.querySelector<HTMLInputElement>('#pair-name')!;
	nameInput.value = suggestedName();
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
		const name = nameInput.value.trim().replace(/\s+/g, ' ');
		if (!name) {
			message.textContent = 'Give this browser a name.';
			message.classList.add('error');
			nameInput.focus();
			return;
		}
		if (!origin) {
			message.textContent = 'Enter a valid pairing code from Prism.';
			message.classList.add('error');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
		submit.disabled = true;
		submit.classList.add('is-busy');
		message.classList.remove('error');
		message.textContent = `Allow access to ${origin} in ${browserName}…`;
		try {
			const permitted = await browser.permissions.request({ origins: [`${origin}/*`] });
			if (!permitted) throw new Error('Site access was not granted. You can try again when ready.');
			const result = (await browser.runtime.sendMessage({
				type: 'pair',
				code: codeInput.value,
				name
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

const popupCss = `${themeCss}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{width:360px;min-height:120px;margin:0;padding:10px;background:var(--canvas);color:var(--ink);font:var(--text-md)/1.45 var(--font-sans);-webkit-font-smoothing:antialiased}
button,input,textarea{font:inherit;color:inherit}
[hidden]{display:none!important}

/* Pairing and notices: the web app's sheet in small. A raised mark, a large title, the code in a
   well that lifts when focused, and one pill to connect. */
.shell{padding:16px 14px 12px;border-radius:20px;background:var(--surface);box-shadow:var(--raised);animation:popup-rise 380ms var(--ease-spring) both}
.mark{display:grid;place-items:center;width:36px;height:36px;margin-bottom:16px;border-radius:var(--radius-control);background:var(--lift);box-shadow:var(--raised);color:var(--ink);animation:popup-pop 420ms 60ms var(--ease-spring) both}
h1{margin:0;font-size:var(--text-title);font-weight:400;letter-spacing:var(--tracking-title);line-height:1.15}
.lede{margin:6px 0 18px;color:var(--secondary);font-size:var(--text-sm);line-height:1.5}
.label{display:block;margin:0 0 6px 4px;color:var(--secondary);font-size:var(--text-sm);font-weight:500}
textarea{display:block;width:100%;resize:none;padding:10px 12px;border:0;border-radius:12px;background:var(--highlight);box-shadow:inset 0 0 0 1px var(--hairline);font:var(--text-sm)/1.5 var(--font-mono);outline:none;transition:background-color 260ms var(--ease-out),box-shadow 380ms var(--ease-spring)}
textarea::placeholder,.field::placeholder{color:var(--tertiary)}
textarea:hover:not(:focus),.field:hover:not(:focus){box-shadow:inset 0 0 0 1px var(--line)}
textarea:focus,.field:focus{background:var(--lift);box-shadow:var(--raised),0 0 0 4px var(--hairline)}
.field{display:block;width:100%;height:38px;padding:0 12px;border:0;border-radius:12px;background:var(--highlight);box-shadow:inset 0 0 0 1px var(--hairline);outline:none;transition:background-color 260ms var(--ease-out),box-shadow 380ms var(--ease-spring)}
.hint-text{margin:6px 4px 14px;color:var(--tertiary);font-size:var(--text-xs)}
.shell .origin{min-height:16px;margin:6px 4px 12px;color:var(--tertiary);font-size:var(--text-xs);overflow-wrap:anywhere}
.shell .message{min-height:16px;margin:10px 4px 0;color:var(--secondary);font-size:var(--text-sm)}
.shell .message:not(:empty){animation:popup-fade 200ms var(--ease-out) both}
.shell .error{color:var(--danger)!important}

.shell .primary{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border:0;border-radius:var(--radius-pill);background:var(--accent);box-shadow:inset 0 1px 0 color-mix(in srgb,white 22%,transparent),0 4px 14px var(--shadow-soft);color:var(--on-accent);font-size:var(--text-md);font-weight:500;cursor:pointer;transition:transform 260ms var(--ease-spring),opacity 160ms var(--ease-out)}
.shell .primary.block{width:100%}
.shell .primary:active:not(:disabled){transform:scale(.97);transition-duration:100ms}
.shell .primary:disabled{cursor:default}
.shell .primary:disabled:not(.is-busy){opacity:.4;box-shadow:none}
.shell .spinner{display:none;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:popup-spin 700ms linear infinite}
.shell .is-busy .spinner{display:block}

/* Connected: a quiet line under the card, its dot breathing slowly. */
.connection{display:flex;align-items:center;gap:8px;padding:10px 4px 0 10px;color:var(--tertiary);font-size:var(--text-xs);animation:popup-fade 400ms 200ms var(--ease-out) both}
.dot{flex:none;width:6px;height:6px;border-radius:50%;background:#5fbf7f;box-shadow:0 0 0 3px rgb(95 191 127 / 16%);animation:popup-breathe 3.2s ease-in-out infinite}
.connection .origin{flex:1;min-height:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.icon-button{display:grid;flex:none;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--radius-pill);background:transparent;color:var(--tertiary);cursor:pointer;transition:background-color 140ms var(--ease-out),color 140ms var(--ease-out)}
.icon-button:hover{background:var(--hover);color:var(--ink)}

/* Settings: the same sheet, a back arrow, then rows like the web app's settings cards. */
.settings-head{display:flex;align-items:center;gap:6px;margin:-6px 0 14px -6px}
h2{margin:0;font-size:var(--text-lg);font-weight:500}
.rows{margin-top:4px;border-top:1px solid var(--hairline)}
.row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--hairline)}
.row:last-child{border-bottom:0}
.row-text{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.row-text strong{font-weight:500}
.row-text small{color:var(--tertiary);font-size:var(--text-xs);line-height:1.4;overflow-wrap:anywhere}
.switch{position:relative;flex:none;width:34px;height:20px;padding:0;border:0;border-radius:var(--radius-pill);background:var(--switch-off);cursor:pointer;transition:background-color 200ms var(--ease-out)}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--switch-knob);box-shadow:0 1px 2px var(--shadow-soft);transition:transform 260ms var(--ease-spring),background-color 200ms var(--ease-out)}
.switch[aria-checked="true"]{background:var(--switch-on)}
.switch[aria-checked="true"]::after{background:var(--switch-on-knob);transform:translateX(14px)}
.quiet.danger{flex:none;height:30px;padding:0 12px;border:0;border-radius:var(--radius-pill);background:transparent;color:var(--secondary);font-size:var(--text-sm);cursor:pointer;transition:background-color 140ms var(--ease-out),color 140ms var(--ease-out)}
.quiet.danger:hover{background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger)}

@keyframes popup-rise{from{opacity:0;transform:translateY(6px) scale(.98);filter:blur(3px)}}
@keyframes popup-pop{from{opacity:0;transform:scale(.7)}}
@keyframes popup-fade{from{opacity:0}}
@keyframes popup-breathe{50%{box-shadow:0 0 0 5px rgb(95 191 127 / 6%)}}
@keyframes popup-spin{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){*:not(.spinner){animation:none!important;transition:none!important}.spinner{animation-duration:1.4s!important}}
`;
/** Renders the toolbar popup into `#app`. */
export function mountPopup() {
	app = document.querySelector<HTMLElement>('#app')!;
	const style = document.createElement('style');
	style.textContent = popupCss;
	document.head.append(style);
	followLook(document);
	void initialize().catch((error) =>
		showMessage('Could not open Prism capture', (error as Error).message)
	);
}
