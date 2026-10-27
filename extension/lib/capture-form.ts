import { browser } from 'wxt/browser';
import type { Capture, Catalog, ExtensionMessage, SaveInput } from './protocol';

const formCss = `
@font-face{font-family:Geist;font-style:normal;font-weight:100 900;font-display:swap;src:url("${browser.runtime.getURL('/geist-latin-wght-normal.woff2')}") format("woff2")}
:host{font-family:Geist,ui-sans-serif,system-ui,sans-serif;color:#efeeeb;color-scheme:dark;font-size:13px;line-height:1.45}
*{box-sizing:border-box}.panel{width:100%;padding:16px;background:#121212;color:#efeeeb}
.heading{margin-bottom:12px}h1{margin:0;font-size:15px;font-weight:600;letter-spacing:-.02em}.sub{margin:3px 0 0;color:#aaa9a5;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.field{position:relative;margin-top:10px}.field-label{display:block;margin:0 0 5px;color:#aaa9a5;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
input,select{width:100%;min-height:36px;padding:7px 10px;border:1px solid #323232;border-radius:8px;background:#202020;color:#efeeeb;font:inherit;outline:none}
input:focus,select:focus{border-color:#777;box-shadow:0 0 0 2px #ffffff12}.title-input{font-size:14px}
.option-list{display:flex;flex-wrap:wrap;gap:5px;max-height:96px;overflow:auto;margin-top:6px}.tag-chip,.person-option,.selected-person{min-height:28px;padding:4px 8px;border:1px solid #343434;border-radius:999px;background:#1a1a1a;color:#aaa9a5;font:inherit;font-size:11px;cursor:pointer}
.tag-chip[aria-pressed="true"],.tag-chip:hover,.person-option:hover{border-color:#777;background:#292929;color:#efeeeb}.selected-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.selected-tags:empty{display:none}.selected-person{display:flex;align-items:center;gap:7px;margin-top:6px;color:#efeeeb}.selected-person span:last-child{color:#aaa9a5}

.footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px}button{min-height:32px;padding:0 10px;border:1px solid #323232;border-radius:8px;background:#1a1a1a;color:#efeeeb;font:inherit;font-size:12px;cursor:pointer}button.primary{border-color:#f5f5f7;background:#f5f5f7;color:#161618;font-weight:600}button:disabled{opacity:.55;cursor:default}
.status{min-height:15px;margin:7px 0 0;color:#aaa9a5;font-size:11px}.status.error{color:#f2a6a0}.empty{width:100%;color:#777;font-size:11px}
.panel.compact{padding:10px 12px}.panel.compact .heading,.panel.compact .footer{display:none}.panel.compact .field{margin-top:8px}.panel.compact .title-input{min-height:34px}.panel.compact .field-label{margin-bottom:4px}.panel.compact .status{margin-top:6px}
`;

type SaveResultMessage = Extract<ExtensionMessage, { type: 'save-result' }>;
async function message<T>(value: ExtensionMessage): Promise<T> {
	try {
		return (await browser.runtime.sendMessage(value)) as T;
	} catch (error) {
		const detail = (error as Error).message;
		if (/receiving end does not exist|could not establish connection/i.test(detail)) {
			// Firefox may briefly have no background listener while waking its MV3 event page.
			await new Promise((resolve) => setTimeout(resolve, 150));
			try {
				return (await browser.runtime.sendMessage(value)) as T;
			} catch {
				throw new Error(
					'Prism’s extension background is unavailable. Reload Prism in about:addons, then refresh this tab.'
				);
			}
		}
		throw error;
	}
}

function setStatus(element: HTMLElement, text: string, error = false) {
	element.textContent = text;
	element.classList.toggle('error', error);
}

export async function renderCaptureForm(
	root: HTMLElement | ShadowRoot,
	capture: Capture,
	onDismiss?: () => void,
	compact = false
) {
	const style = document.createElement('style');
	style.textContent = formCss;
	root.append(style);
	const panel = document.createElement('section');
	panel.className = compact ? 'panel compact' : 'panel';
	panel.innerHTML = `
		<div class="heading"><h1>Save to Prism</h1><p class="sub"></p></div>
		<form>
			<input class="title-input" aria-label="Title" placeholder="Title" maxlength="500" required />
			<div class="field">
				<label class="field-label" for="prism-tag-search">Tags</label>
				<input id="prism-tag-search" type="search" placeholder="Search tags" autocomplete="off" />
				<div class="selected-tags" aria-label="Selected tags"></div>
				<div class="option-list tag-options" role="listbox" aria-label="Matching tags"></div>
			</div>
			<div class="field">
				<label class="field-label" for="prism-person-search">Person</label>
				<input id="prism-person-search" type="search" placeholder="Search people (optional)" autocomplete="off" />
				<div class="person-selection"></div>
				<div class="option-list person-options" role="listbox" aria-label="Matching people"></div>
			</div>
			<div class="footer"><button type="button" data-dismiss>Cancel</button><button class="primary" type="submit">Save</button></div>
			<p class="status" role="status" aria-live="polite"></p>
		</form>`;
	root.append(panel);
	const form = panel.querySelector('form')!;
	const title = panel.querySelector<HTMLInputElement>('.title-input')!;
	const tagSearch = panel.querySelector<HTMLInputElement>('#prism-tag-search')!;
	const tagOptions = panel.querySelector<HTMLElement>('.tag-options')!;
	const selectedTags = panel.querySelector<HTMLElement>('.selected-tags')!;
	const personSearch = panel.querySelector<HTMLInputElement>('#prism-person-search')!;
	const personOptions = panel.querySelector<HTMLElement>('.person-options')!;
	const personSelection = panel.querySelector<HTMLElement>('.person-selection')!;
	const status = panel.querySelector<HTMLElement>('.status')!;
	const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
	panel.querySelector<HTMLElement>('.sub')!.textContent = new URL(capture.url).hostname;
	title.value = capture.title.slice(0, 500);
	if (compact) title.focus();

	let catalog: Catalog = { tags: [], people: [] };
	let selectedTagIds = new Set<string>();
	let selectedPerson: Catalog['people'][number] | undefined;
	let activeOperationId: string | undefined;
	let catalogReady = false;

	function renderTags() {
		const query = tagSearch.value.trim().toLocaleLowerCase();
		const matchingTags = catalog.tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query));
		const matches = matchingTags.filter((tag) => !selectedTagIds.has(tag.id));
		selectedTags.replaceChildren();
		for (const tag of catalog.tags.filter((item) => selectedTagIds.has(item.id))) {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'tag-chip';
			chip.textContent = `${tag.name} ×`;
			chip.setAttribute('aria-pressed', 'true');
			chip.addEventListener('click', () => {
				selectedTagIds.delete(tag.id);
				renderTags();
			});
			selectedTags.append(chip);
		}
		tagOptions.replaceChildren();
		if (!catalogReady) return;
		if (!catalog.tags.length) {
			const empty = document.createElement('span');
			empty.className = 'empty';
			empty.textContent = 'Create tags in Prism first.';
			tagOptions.append(empty);
			return;
		}
		if (!matches.length) {
			const empty = document.createElement('span');
			empty.className = 'empty';
			empty.textContent = matchingTags.length ? 'Already selected.' : 'No matching tags.';
			tagOptions.append(empty);
			return;
		}
		for (const tag of matches.slice(0, 24)) {
			const option = document.createElement('button');
			option.type = 'button';
			option.className = 'tag-chip';
			option.textContent = tag.name;
			option.setAttribute('role', 'option');
			option.setAttribute('aria-pressed', String(selectedTagIds.has(tag.id)));
			option.addEventListener('click', () => {
				if (selectedTagIds.has(tag.id)) selectedTagIds.delete(tag.id);
				else selectedTagIds.add(tag.id);
				renderTags();
			});
			tagOptions.append(option);
		}
	}

	function renderPeople() {
		personOptions.replaceChildren();
		personSelection.replaceChildren();
		if (selectedPerson) {
			const selection = document.createElement('button');
			selection.type = 'button';
			selection.className = 'selected-person';
			selection.textContent = `${selectedPerson.displayName}  ×`;
			selection.setAttribute('aria-label', `Remove ${selectedPerson.displayName}`);
			selection.addEventListener('click', () => {
				selectedPerson = undefined;
				renderPeople();
				personSearch.focus();
			});
			personSelection.append(selection);
			return;
		}
		const query = personSearch.value.trim().toLocaleLowerCase();
		if (!query || !catalogReady) return;
		const matches = catalog.people.filter((person) =>
			person.displayName.toLocaleLowerCase().includes(query)
		);
		if (!matches.length) {
			const empty = document.createElement('span');
			empty.className = 'empty';
			empty.textContent = 'No matching people.';
			personOptions.append(empty);
			return;
		}
		for (const person of matches.slice(0, 8)) {
			const option = document.createElement('button');
			option.type = 'button';
			option.className = 'person-option';
			option.textContent = person.displayName;
			option.setAttribute('role', 'option');
			option.addEventListener('click', () => {
				selectedPerson = person;
				personSearch.value = '';
				renderPeople();
			});
			personOptions.append(option);
		}
	}

	tagSearch.addEventListener('input', renderTags);
	tagSearch.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return;
		const query = tagSearch.value.trim().toLocaleLowerCase();
		if (!query || !catalogReady) return;
		const match = catalog.tags.find(
			(tag) => !selectedTagIds.has(tag.id) && tag.name.toLocaleLowerCase().includes(query)
		);
		if (!match) return;
		event.preventDefault();
		selectedTagIds.add(match.id);
		tagSearch.value = '';
		renderTags();
	});
	personSearch.addEventListener('input', renderPeople);

	const catalogResponse = (await message<Catalog & { error?: string }>({ type: 'catalog' })) ?? {
		tags: [],
		people: []
	};
	if (catalogResponse.error) {
		const needsPairing = catalogResponse.error.includes('Connect the extension from Prism');
		setStatus(
			status,
			needsPairing ? 'Connect from the Prism toolbar popup first.' : catalogResponse.error,
			!needsPairing
		);
		submit.disabled = true;
		if (!needsPairing) {
			const disconnect = document.createElement('button');
			disconnect.type = 'button';
			disconnect.textContent = 'Disconnect';
			disconnect.addEventListener('click', async () => {
				await message({ type: 'disconnect' });
				if (onDismiss) onDismiss();
				else panel.dispatchEvent(new CustomEvent('prism-close', { bubbles: true }));
			});
			panel.querySelector('.footer')?.append(disconnect);
		}
	} else {
		catalog = catalogResponse;
		catalogReady = true;
		renderTags();
		renderPeople();
		if (compact) setStatus(status, 'Press Enter to save from any field.');
	}

	panel.querySelector<HTMLButtonElement>('[data-dismiss]')?.addEventListener('click', () => {
		if (onDismiss) onDismiss();
		else panel.dispatchEvent(new CustomEvent('prism-close', { bubbles: true }));
	});

	const onSaveResult = (raw: unknown) => {
		const result = raw as SaveResultMessage;
		if (result?.type !== 'save-result' || result.operationId !== activeOperationId) return;
		if (result.error) {
			setStatus(status, result.error, true);
			submit.disabled = false;
			submit.textContent = 'Save';
			return;
		}
		setStatus(
			status,
			result.status === 'already_exists' ? 'This bookmark is already in Prism.' : 'Saved to Prism.'
		);
		submit.textContent = result.status === 'already_exists' ? 'Already saved' : 'Saved';
	};
	browser.runtime.onMessage.addListener(onSaveResult);
	const dispose = () => browser.runtime.onMessage.removeListener(onSaveResult);
	root.addEventListener('prism-dispose', dispose, { once: true });

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (submit.disabled || !catalogReady) return;
		const operationId = crypto.randomUUID();
		const input: SaveInput = {
			protocolVersion: 1,
			operationId,
			command: {
				type: 'extension.bookmark.create',
				id: crypto.randomUUID(),
				kind: capture.kind,
				title: title.value.trim(),
				url: capture.url,
				tagIds: [...selectedTagIds],
				...(selectedPerson ? { person: { id: selectedPerson.id } } : {})
			}
		};
		activeOperationId = operationId;
		submit.disabled = true;
		submit.textContent = 'Queued';
		setStatus(status, 'Sending to Prism in the background…');
		try {
			const result = await message<{ queued?: boolean; error?: string }>({ type: 'save', input });
			if (result?.error) throw new Error(result.error);
			if (!result?.queued) throw new Error('Prism could not queue this bookmark.');
			setStatus(status, 'Queued. You can keep browsing while Prism saves it.');
		} catch (error) {
			setStatus(status, (error as Error).message, true);
			submit.disabled = false;
			submit.textContent = 'Save';
		}
	});

	return panel;
}
