import { browser } from 'wxt/browser';
import type { Capture, Catalog, ExtensionMessage, PersonRole, SaveInput } from './protocol';

const formCss = `
@font-face{font-family:Geist;font-style:normal;font-weight:100 900;font-display:swap;src:url("${browser.runtime.getURL('/geist-latin-wght-normal.woff2')}") format("woff2")}
:host{font-family:Geist,ui-sans-serif,system-ui,sans-serif;color:#efeeeb;color-scheme:dark;font-size:13px;line-height:1.45}
*{box-sizing:border-box} .panel{width:100%;padding:16px;background:#121212;color:#efeeeb}
h1{margin:0;font-size:16px;font-weight:600;letter-spacing:-.02em} .sub{margin:4px 0 14px;color:#aaa9a5;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
label{display:block;margin:12px 0 5px;color:#aaa9a5;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
input,select{width:100%;min-height:38px;padding:8px 10px;border:1px solid #323232;border-radius:9px;background:#202020;color:#efeeeb;font:inherit;outline:none}
input:focus,select:focus{border-color:#aaa9a5;box-shadow:0 0 0 2px #ffffff15}
.chips{display:flex;flex-wrap:wrap;gap:6px;max-height:118px;overflow:auto;padding:2px 0}
.chip{display:flex;align-items:center;gap:6px;margin:0;padding:5px 8px;border:1px solid #323232;border-radius:999px;background:#1a1a1a;color:#aaa9a5;font-size:12px;font-weight:400;letter-spacing:0;text-transform:none;cursor:pointer}
.chip.selected{border-color:#aaa9a5;background:#292929;color:#efeeeb}.chip input{width:14px;min-height:14px;margin:0;accent-color:#f5f5f7}
.row{display:grid;grid-template-columns:1fr 112px;gap:8px}.footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}
button{min-height:36px;padding:0 12px;border:1px solid #323232;border-radius:9px;background:#1a1a1a;color:#efeeeb;font:inherit;cursor:pointer}
button.primary{border-color:#f5f5f7;background:#f5f5f7;color:#161618;font-weight:600}button:disabled{opacity:.5;cursor:default}
.status{min-height:18px;margin:10px 0 0;color:#aaa9a5;font-size:12px}.status.error{color:#f2a6a0}.none{color:#aaa9a5;font-size:12px}
`;

function message<T>(value: ExtensionMessage): Promise<T> {
	return browser.runtime.sendMessage(value) as Promise<T>;
}

function setStatus(element: HTMLElement, text: string, error = false) {
	element.textContent = text;
	element.classList.toggle('error', error);
}

export async function renderCaptureForm(
	root: HTMLElement | ShadowRoot,
	capture: Capture,
	onDismiss?: () => void
) {
	const style = document.createElement('style');
	style.textContent = formCss;
	root.append(style);
	const panel = document.createElement('section');
	panel.className = 'panel';
	panel.innerHTML = `
		<h1>Save to Prism</h1>
		<p class="sub" title="${escapeHtml(capture.url)}">${escapeHtml(new URL(capture.url).hostname)}</p>
		<form>
			<label for="prism-title">Title</label>
			<input id="prism-title" maxlength="500" required />
			<label>Tags</label>
			<div class="chips" aria-label="Tags"></div>
			<p class="none" hidden>No tags yet. Create tags in Prism first.</p>
			<label for="prism-person">Person (optional)</label>
			<div class="row">
				<select id="prism-person"><option value="">No person</option></select>
				<select id="prism-role" aria-label="Person role">
					<option value="author">Author</option><option value="about">About</option><option value="related">Related</option>
				</select>
			</div>
			<div class="footer"><button type="button" data-dismiss>Cancel</button><button class="primary" type="submit">Save bookmark</button></div>
			<p class="status" role="status" aria-live="polite"></p>
		</form>`;
	root.append(panel);
	const form = panel.querySelector('form')!;
	const title = panel.querySelector<HTMLInputElement>('#prism-title')!;
	const tagArea = panel.querySelector<HTMLElement>('.chips')!;
	const none = panel.querySelector<HTMLElement>('.none')!;
	const person = panel.querySelector<HTMLSelectElement>('#prism-person')!;
	const role = panel.querySelector<HTMLSelectElement>('#prism-role')!;
	const status = panel.querySelector<HTMLElement>('.status')!;
	title.value = capture.title.slice(0, 500);
	role.value = capture.kind === 'social' ? 'author' : 'related';

	const catalogResponse: Catalog & { error?: string } = (await message<
		Catalog & { error?: string }
	>({ type: 'catalog' })) ?? { tags: [], people: [] };
	if (catalogResponse.error) {
		const needsPairing = catalogResponse.error.includes('Connect the extension from Prism');
		setStatus(
			status,
			needsPairing ? 'Connect from the Prism toolbar popup first.' : catalogResponse.error,
			!needsPairing
		);
		form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = true;
		if (!needsPairing) {
			const disconnect = document.createElement('button');
			disconnect.type = 'button';
			disconnect.textContent = 'Disconnect device';
			disconnect.addEventListener('click', async () => {
				await message({ type: 'disconnect' });
				if (onDismiss) onDismiss();
				else setStatus(status, 'Disconnected. Reconnect from the Prism toolbar popup.');
			});
			panel.querySelector('.footer')?.append(disconnect);
		}
	} else {
		for (const tag of catalogResponse.tags ?? []) {
			const label = document.createElement('label');
			label.className = 'chip';
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.value = tag.id;
			input.addEventListener('change', () => label.classList.toggle('selected', input.checked));
			label.append(input, document.createTextNode(tag.name));
			tagArea.append(label);
		}
		none.hidden = (catalogResponse.tags ?? []).length > 0;
		for (const entry of catalogResponse.people ?? []) {
			const option = document.createElement('option');
			option.value = entry.id;
			option.textContent = entry.displayName;
			person.append(option);
		}
	}

	person.addEventListener('change', () => {
		role.disabled = !person.value;
	});
	role.disabled = true;
	panel.querySelector<HTMLButtonElement>('[data-dismiss]')?.addEventListener('click', () => {
		if (onDismiss) onDismiss();
		else panel.dispatchEvent(new CustomEvent('prism-close', { bubbles: true }));
	});
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
		const selectedPerson = person.value;
		const input: SaveInput = {
			protocolVersion: 1,
			operationId: crypto.randomUUID(),
			command: {
				type: 'extension.bookmark.create',
				id: crypto.randomUUID(),
				kind: capture.kind,
				title: title.value.trim(),
				url: capture.url,
				tagIds: [...tagArea.querySelectorAll<HTMLInputElement>('input:checked')].map(
					(item) => item.value
				),
				...(selectedPerson
					? { person: { id: selectedPerson, role: role.value as PersonRole } }
					: {})
			}
		};
		submit.disabled = true;
		setStatus(status, 'Saving…');
		try {
			const result = await message<{
				status?: string;
				error?: string | { message?: string };
				message?: string;
			}>({ type: 'save', input });
			if (typeof result?.error === 'string') throw new Error(result.error);
			if (result?.status === 'rejected') {
				const detail = result.error as { message?: string } | undefined;
				throw new Error(detail?.message ?? 'Prism could not save this bookmark.');
			}
			if (result?.status === 'already_exists') setStatus(status, 'This page is already in Prism.');
			else setStatus(status, 'Saved to Prism.');
			submit.textContent = result?.status === 'already_exists' ? 'Already saved' : 'Saved';
		} catch (error) {
			setStatus(status, (error as Error).message, true);
			submit.disabled = false;
		}
	});
	return panel;
}

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			})[character]!
	);
}
