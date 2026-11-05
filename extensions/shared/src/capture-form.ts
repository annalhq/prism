import { browser } from 'wxt/browser';
import { extensionsPage } from './platform';
import type { Capture, Catalog, ExtensionMessage, SaveInput } from './protocol';
import { avatarHue, icons, initials, themeCss } from './theme';

type Tag = Catalog['tags'][number];
type Person = Catalog['people'][number];
type NewTag = { id: string; name: string };
type Token =
	| { kind: 'tag'; item: Tag }
	| { kind: 'new-tag'; item: NewTag }
	| { kind: 'person'; item: Person };
type SaveState = 'idle' | 'saving' | 'queued' | 'saved';

// Matches the web app's capture card: a serif title, a faint well for tags and people that
// lifts into the raised tab while typing, raised chips and suggestions, people as their coloured
// monogram, and motion on one soft spring. Radii nest: card 20 − padding 8 → wells 12.
const formCss = `${themeCss}
:host{display:block}
.panel{font-family:var(--font);font-size:13px;line-height:1.45;color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.panel *{box-sizing:border-box}
.panel button,.panel input{font:inherit;color:inherit}
.panel .card{display:flex;flex-direction:column;margin:0;padding:8px;background:var(--surface);border-radius:var(--r-panel);box-shadow:var(--raised),0 18px 48px var(--shadow-strong);overflow:hidden}
.panel.compact .card{box-shadow:var(--raised)}
.panel:not(.compact) .card{animation:prism-rise 380ms var(--spring) both}

.panel .site{display:flex;align-items:center;gap:7px;min-width:0;padding:6px 8px 0;color:var(--ink-3);font-size:11px}
.panel .site-icon{display:grid;flex:none;place-items:center;width:14px;height:14px}
.panel .site-icon img{width:14px;height:14px;border-radius:3px}
.panel .site-host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.panel .title{width:100%;margin:0;padding:6px 8px 12px;border:0;background:transparent;font-size:20px;font-weight:400;line-height:1.25;letter-spacing:-0.01em;outline:none}
.panel .title::placeholder,.panel .token-input::placeholder{color:var(--ink-3);opacity:1}
.panel .title[aria-invalid="true"]::placeholder{color:var(--danger)}
.panel .divider{display:none}

.panel .tokens{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-height:44px;padding:6px 8px;border-radius:calc(var(--r-panel) - 8px);background:var(--highlight);box-shadow:inset 0 0 0 1px var(--hairline);cursor:text;transition:background-color 260ms var(--ease),box-shadow 380ms var(--spring)}
.panel .tokens:hover:not(:focus-within){box-shadow:inset 0 0 0 1px var(--line)}
.panel .tokens:focus-within{background:var(--lift);box-shadow:var(--raised)}
.panel .tokens.locked{background:transparent;box-shadow:inset 0 0 0 1px var(--hairline)}
.panel .token-input{flex:1 1 90px;min-width:90px;height:28px;margin:0;padding:0 2px;border:0;background:transparent;outline:none}
.panel .token-input:disabled{cursor:default}
.panel .chip{display:inline-flex;align-items:center;gap:5px;height:28px;max-width:100%;padding:0 3px 0 9px;border-radius:var(--r-pill);background:var(--lift);box-shadow:var(--raised);color:var(--ink);font-size:12px;font-weight:500;cursor:default}
.panel .chip.person{padding-left:3px;gap:6px}
.panel .chip.enter{animation:prism-pop 300ms var(--spring) both}
.panel .chip-glyph{display:grid;flex:none;place-items:center;color:var(--ink-3)}
.panel .chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel .chip-remove{display:grid;flex:none;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--r-pill);background:transparent;color:var(--ink-3);cursor:pointer;opacity:.7;transition:opacity 140ms var(--ease),background-color 140ms var(--ease),color 140ms var(--ease)}
.panel .chip:hover .chip-remove{opacity:1}
.panel .chip-remove:hover{background:var(--hover);color:var(--ink)}
.panel .chip-remove:disabled{display:none}
.panel .tokens.locked .chip{padding-right:9px}

.panel .avatar{display:grid;flex:none;place-items:center;width:var(--size);height:var(--size);border-radius:50%;background:hsl(var(--hue) 32% 27%);box-shadow:0 0 0 1px var(--hairline);color:hsl(var(--hue) 70% 86%);font-size:calc(var(--size) * .4);font-weight:500;line-height:1;user-select:none}
@media (prefers-color-scheme:light){.panel .avatar{background:hsl(var(--hue) 70% 88%);color:hsl(var(--hue) 38% 30%)}}

.panel .suggest{margin-top:6px;padding:4px;border-radius:calc(var(--r-panel) - 8px);background:var(--highlight);box-shadow:inset 0 0 0 1px var(--hairline);transform-origin:top center;animation:prism-drop 240ms var(--spring) both}
.panel .suggest[hidden]{display:none}
.panel .options{max-height:212px;margin:0;padding:0;overflow:auto;list-style:none;scrollbar-width:none}
.panel .options:empty{display:none}
.panel .option{display:flex;align-items:center;gap:9px;height:34px;padding:0 8px;border-radius:8px;color:var(--ink-2);cursor:pointer;user-select:none;transition:background-color 120ms var(--ease),box-shadow 120ms var(--ease),color 120ms var(--ease)}
.panel .option[aria-selected="true"]{background:var(--lift);box-shadow:var(--raised);color:var(--ink)}
.panel .option-glyph{display:grid;flex:none;place-items:center;width:20px;height:20px;color:var(--ink-3)}
.panel .option[aria-selected="true"] .option-glyph{color:var(--ink)}
.panel .option-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel .option-meta{flex:none;color:var(--ink-3);font-size:11px}
.panel .option.create .option-label b{color:var(--ink);font-weight:500}
.panel .note{margin:0;padding:6px 8px 4px;color:var(--ink-3);font-size:12px}
.panel .note:empty{display:none}

.panel .status{margin:0;padding:10px 8px 0;color:var(--ink-2);font-size:12px;animation:prism-fade 200ms var(--ease) both}
.panel .status:empty{display:none}
.panel .status.error{color:var(--danger)}

.panel .footer{position:relative;display:flex;align-items:center;gap:6px;margin-top:10px;padding:8px 0 0}
.panel .footer::before{content:"";position:absolute;top:0;right:8px;left:8px;border-top:1px solid var(--hairline)}
.panel .quiet{height:32px;padding:0 12px;border:0;border-radius:var(--r-pill);background:transparent;color:var(--ink-2);font-size:12px;cursor:pointer;transition:background-color 140ms var(--ease),box-shadow 140ms var(--ease),color 140ms var(--ease),transform 240ms var(--spring)}
.panel .quiet:hover{background:var(--lift);box-shadow:var(--raised);color:var(--ink)}
.panel .quiet:active{transform:scale(.96)}
.panel .hint{display:flex;gap:3px;margin-left:auto;color:var(--ink-3);font-size:10.5px}
.panel .hint kbd{display:inline-grid;place-items:center;min-width:14px;height:18px;padding:0 1px;border:0;background:none;font:inherit;line-height:18px}
.panel .primary{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:76px;height:32px;padding:0 14px;border:0;border-radius:var(--r-pill);background:var(--accent);box-shadow:inset 0 1px 0 color-mix(in srgb,white 22%,transparent),0 4px 14px var(--shadow-soft);color:var(--accent-ink);font-size:12px;font-weight:500;cursor:pointer;transition:transform 260ms var(--spring),opacity 160ms var(--ease),box-shadow 160ms var(--ease)}
.panel .primary:active:not(:disabled){transform:scale(.96);transition-duration:100ms}
.panel .primary:disabled{cursor:default}
.panel .primary:disabled:not(.is-saving):not(.is-saved){opacity:.4;box-shadow:none}
.panel .btn-icon{display:none;place-items:center;width:13px;height:13px}
.panel .is-saving .btn-icon,.panel .is-saved .btn-icon{display:grid}
.panel .spinner{width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:prism-spin 700ms linear infinite}
.panel .btn-icon svg{display:none}
.panel .is-saved .spinner{display:none}
.panel .is-saved .btn-icon svg{display:block;animation:prism-pop 360ms var(--spring) both}
.panel .is-saved{animation:prism-saved 420ms var(--spring)}

.panel button:focus-visible,.option:focus-visible{outline:2px solid var(--ring);outline-offset:1px}

@keyframes prism-rise{from{opacity:0;transform:translateY(6px) scale(.98);filter:blur(3px)}}
@keyframes prism-drop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
@keyframes prism-fade{from{opacity:0;transform:translateY(-2px)}}
@keyframes prism-pop{from{opacity:0;transform:scale(.7)}}
@keyframes prism-saved{40%{transform:scale(1.05)}}
@keyframes prism-spin{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){
.panel *:not(.spinner){animation:none!important;transition:none!important}
.panel .spinner{animation-duration:1.4s}
}
`;

/** A tag's # or a person's coloured monogram, the same glyphs the web app draws. */
function glyph(token: Token, size: number): HTMLElement {
	if (token.kind !== 'person') {
		const icon = document.createElement('span');
		icon.innerHTML = icons.hash;
		icon.style.display = 'grid';
		return icon;
	}
	const avatar = document.createElement('span');
	avatar.className = 'avatar';
	avatar.style.setProperty('--size', `${size}px`);
	avatar.style.setProperty('--hue', String(avatarHue(token.item.displayName)));
	avatar.textContent = initials(token.item.displayName);
	return avatar;
}

type SaveResultMessage = Extract<ExtensionMessage, { type: 'save-result' }>;
async function message<T>(value: ExtensionMessage): Promise<T> {
	try {
		return (await browser.runtime.sendMessage(value)) as T;
	} catch (error) {
		const detail = (error as Error).message;
		if (/receiving end does not exist|could not establish connection/i.test(detail)) {
			// The MV3 background (Firefox event page, Chrome service worker) may briefly have no
			// listener while it wakes.
			await new Promise((resolve) => setTimeout(resolve, 150));
			try {
				return (await browser.runtime.sendMessage(value)) as T;
			} catch {
				throw new Error(
					`Prism’s extension background is unavailable. Reload Prism in ${extensionsPage}, then refresh this tab.`
				);
			}
		}
		throw error;
	}
}

/** Prefix matches first, then word-start matches, then substring matches; catalog order otherwise. */
function rank<T>(items: T[], name: (item: T) => string, query: string): T[] {
	if (!query) return items;
	return items
		.flatMap((item, index) => {
			const value = name(item).toLocaleLowerCase();
			const at = value.indexOf(query);
			if (at < 0) return [];
			const score = at === 0 ? 0 : /[\s\-_/.]/.test(value[at - 1] ?? '') ? 1 : 2;
			return [{ item, index, score }];
		})
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.map((entry) => entry.item);
}

const tokenName = (token: Token) =>
	token.kind === 'person' ? token.item.displayName : token.item.name;
const tokenKey = (token: Token) => `${token.kind}:${token.item.id}`;
const fold = (name: string) => name.normalize('NFC').toLocaleLowerCase();

export async function renderCaptureForm(
	root: HTMLElement | ShadowRoot,
	capture: Capture,
	onDismiss?: () => void,
	compact = false,
	options: { favicon?: string } = {}
) {
	const style = document.createElement('style');
	style.textContent = formCss;
	root.append(style);
	const panel = document.createElement('section');
	panel.className = compact ? 'panel compact' : 'panel';
	panel.setAttribute('aria-label', 'Save to Prism');
	const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
	panel.innerHTML = `
		<form class="card" novalidate>
			<div class="site"><span class="site-icon">${icons.folder}</span><span class="site-host"></span></div>
			<input class="title" aria-label="Title" placeholder="Untitled" maxlength="500" autocomplete="off" />
			<div class="divider"></div>
			<div class="tokens" role="group" aria-label="Tags and person">
				<input class="token-input" type="text" role="combobox" aria-label="Add tags or a person"
					aria-autocomplete="list" aria-expanded="false" aria-controls="prism-suggestions"
					autocomplete="off" spellcheck="false" placeholder="Loading tags…" />
			</div>
			<div class="suggest" hidden>
				<ul class="options" id="prism-suggestions" role="listbox" aria-label="Suggestions"></ul>
				<p class="note"></p>
			</div>
			<p class="status" role="status" aria-live="polite"></p>
			<div class="footer">
				<button type="button" class="quiet" data-dismiss>${compact ? 'Cancel' : 'Close'}</button>
				<span class="hint" title="Save with ${isMac ? '⌘' : 'Ctrl'}+Enter" aria-hidden="true"><kbd>${isMac ? '⌘' : 'Ctrl'}</kbd><kbd>${icons.enter}</kbd></span>
				<button type="submit" class="primary"><span class="btn-icon" aria-hidden="true"><span class="spinner"></span>${icons.check}</span><span class="btn-label">Save</span></button>
			</div>
		</form>`;
	root.append(panel);
	const form = panel.querySelector('form')!;
	const title = panel.querySelector<HTMLInputElement>('.title')!;
	const tokensEl = panel.querySelector<HTMLElement>('.tokens')!;
	const tokenInput = panel.querySelector<HTMLInputElement>('.token-input')!;
	const suggest = panel.querySelector<HTMLElement>('.suggest')!;
	const optionsEl = panel.querySelector<HTMLElement>('.options')!;
	const note = panel.querySelector<HTMLElement>('.note')!;
	const status = panel.querySelector<HTMLElement>('.status')!;
	const dismissButton = panel.querySelector<HTMLButtonElement>('[data-dismiss]')!;
	const submit = panel.querySelector<HTMLButtonElement>('button[type="submit"]')!;
	const submitLabel = submit.querySelector<HTMLElement>('.btn-label')!;

	const hostname = new URL(capture.url).hostname.replace(/^www\./, '');
	panel.querySelector<HTMLElement>('.site-host')!.textContent = hostname;
	if (options.favicon && /^(https:|data:image\/)/.test(options.favicon)) {
		const siteIcon = panel.querySelector<HTMLElement>('.site-icon')!;
		const img = document.createElement('img');
		img.alt = '';
		img.src = options.favicon;
		img.addEventListener('error', () => (siteIcon.innerHTML = icons.folder), { once: true });
		siteIcon.replaceChildren(img);
	}
	title.value = capture.title.slice(0, 500);

	let catalog: Catalog = { tags: [], people: [] };
	let catalogReady = false;
	let tokens: Token[] = [];
	let lastAddedKey: string | undefined;
	let suggestions: Token[] = [];
	let active = 0;
	let tokenFocused = false;
	let state: SaveState = 'idle';
	let activeOperationId: string | undefined;
	let queuedTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const placeholder = 'Add or create #tags, or @person';
	function dismiss() {
		if (onDismiss) onDismiss();
		else panel.dispatchEvent(new CustomEvent('prism-close', { bubbles: true }));
	}
	function setStatus(text: string, error = false) {
		status.textContent = text;
		status.classList.toggle('error', error);
	}
	function setState(next: SaveState, label?: string) {
		state = next;
		submit.classList.toggle('is-saving', next === 'saving');
		submit.classList.toggle('is-saved', next === 'saved');
		submit.disabled = next !== 'idle';
		submit.setAttribute('aria-busy', String(next === 'saving'));
		submitLabel.textContent =
			label ?? { idle: 'Save', saving: 'Saving', queued: 'Queued', saved: 'Saved' }[next];
		const locked = next !== 'idle';
		title.readOnly = locked;
		tokenInput.disabled = locked || !catalogReady;
		tokensEl.classList.toggle('locked', locked);
		for (const remove of tokensEl.querySelectorAll<HTMLButtonElement>('.chip-remove'))
			remove.disabled = locked;
		if (locked) closeList();
	}

	function renderTokens() {
		for (const chip of tokensEl.querySelectorAll('.chip')) chip.remove();
		for (const token of tokens) {
			const chip = document.createElement('span');
			chip.className = `chip${token.kind === 'person' ? ' person' : ''}${tokenKey(token) === lastAddedKey ? ' enter' : ''}`;
			const chipGlyph = document.createElement('span');
			chipGlyph.className = 'chip-glyph';
			chipGlyph.append(glyph(token, 22));
			const label = document.createElement('span');
			label.className = 'chip-label';
			label.textContent = tokenName(token);
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'chip-remove';
			remove.tabIndex = -1; // Backspace removes chips from the keyboard.
			remove.disabled = state !== 'idle';
			remove.setAttribute(
				'aria-label',
				`Remove ${token.kind === 'person' ? 'person' : 'tag'} ${tokenName(token)}`
			);
			remove.innerHTML = icons.x;
			remove.addEventListener('click', () => {
				tokens = tokens.filter((candidate) => candidate !== token);
				renderTokens();
				tokenInput.focus();
				renderSuggestions();
			});
			chip.append(chipGlyph, label, remove);
			tokensEl.insertBefore(chip, tokenInput);
		}
		lastAddedKey = undefined;
		if (catalogReady) tokenInput.placeholder = tokens.length ? '' : placeholder;
	}

	function closeList() {
		suggestions = [];
		optionsEl.replaceChildren();
		note.textContent = '';
		suggest.hidden = true;
		tokenInput.setAttribute('aria-expanded', 'false');
		tokenInput.removeAttribute('aria-activedescendant');
	}
	function setActive(index: number) {
		active = index;
		optionsEl.querySelectorAll<HTMLElement>('.option').forEach((option, i) => {
			option.setAttribute('aria-selected', String(i === index));
			if (i === index) {
				tokenInput.setAttribute('aria-activedescendant', option.id);
				option.scrollIntoView({ block: 'nearest' });
			}
		});
	}
	function pick(token: Token) {
		tokens =
			token.kind === 'person'
				? [...tokens.filter((candidate) => candidate.kind !== 'person'), token]
				: [...tokens, token];
		lastAddedKey = tokenKey(token);
		tokenInput.value = '';
		renderTokens();
		closeList();
		tokenInput.focus();
	}
	function renderSuggestions() {
		const raw = tokenInput.value.trimStart();
		const mode = raw.startsWith('#') ? 'tags' : raw.startsWith('@') ? 'people' : 'all';
		const query = (mode === 'all' ? raw : raw.slice(1)).trim().toLocaleLowerCase();
		if (!catalogReady || !tokenFocused || state !== 'idle' || (mode === 'all' && !query))
			return closeList();
		const tagIds = new Set(tokens.flatMap((token) => (token.kind === 'tag' ? [token.item.id] : [])));
		// Names already on this bookmark, chosen or about to be created.
		const takenNames = new Set(
			tokens.flatMap((token) => (token.kind === 'person' ? [] : [fold(token.item.name)]))
		);
		const person = tokens.find((token) => token.kind === 'person')?.item as Person | undefined;
		const tags =
			mode === 'people'
				? []
				: rank(
						catalog.tags.filter((tag) => !tagIds.has(tag.id)),
						(tag) => tag.name,
						query
					).slice(0, mode === 'tags' ? 8 : 5);
		const people =
			mode === 'tags'
				? []
				: rank(
						catalog.people.filter((candidate) => candidate.id !== person?.id),
						(candidate) => candidate.displayName,
						query
					).slice(0, mode === 'people' ? 8 : 4);
		// What was typed, as a tag name: no leading #, single spaces, Prism's 64-character limit.
		const typed = (mode === 'all' ? raw : raw.slice(1)).trim().replace(/\s+/g, ' ').slice(0, 64);
		const exists = catalog.tags.some((tag) => fold(tag.name) === fold(typed));
		const create: Token[] =
			mode !== 'people' && typed && !exists && !takenNames.has(fold(typed))
				? [{ kind: 'new-tag', item: { id: crypto.randomUUID(), name: typed } }]
				: [];
		suggestions = [
			...tags.map((item): Token => ({ kind: 'tag', item })),
			...people.map((item): Token => ({ kind: 'person', item })),
			...create
		];
		let noteText = '';
		if (!suggestions.length) {
			if (mode === 'people')
				noteText = catalog.people.length ? 'No matching people.' : 'No people in Prism yet.';
			else if (typed && (exists || takenNames.has(fold(typed))))
				noteText = `#${typed} is already added.`;
			else if (!typed) noteText = catalog.tags.length ? 'All tags are added.' : 'Type a name to create a tag.';
		}
		if (!suggestions.length && !noteText) return closeList();
		optionsEl.replaceChildren();
		suggestions.forEach((token, index) => {
			const option = document.createElement('li');
			option.className = 'option';
			option.id = `prism-option-${index}`;
			option.setAttribute('role', 'option');
			const optionGlyph = document.createElement('span');
			optionGlyph.className = 'option-glyph';
			optionGlyph.append(glyph(token, 20));
			const label = document.createElement('span');
			label.className = 'option-label';
			if (token.kind === 'new-tag') {
				option.classList.add('create');
				label.append('Create ');
				const name = document.createElement('b');
				name.textContent = `#${token.item.name}`;
				label.append(name);
			} else label.textContent = tokenName(token);
			option.append(optionGlyph, label);
			if (token.kind === 'person') {
				const meta = document.createElement('span');
				meta.className = 'option-meta';
				meta.textContent = person ? `Replaces ${person.displayName}` : 'Person';
				option.append(meta);
			}
			// Keep focus in the input so typing and keyboard navigation continue.
			option.addEventListener('pointerdown', (event) => event.preventDefault());
			option.addEventListener('pointermove', () => active !== index && setActive(index));
			option.addEventListener('click', () => pick(token));
			optionsEl.append(option);
		});
		note.textContent = noteText;
		suggest.hidden = false;
		tokenInput.setAttribute('aria-expanded', String(suggestions.length > 0));
		if (suggestions.length) setActive(Math.min(active, suggestions.length - 1));
		else tokenInput.removeAttribute('aria-activedescendant');
	}

	tokensEl.addEventListener('pointerdown', (event) => {
		if (event.target === tokensEl) {
			event.preventDefault();
			tokenInput.focus();
		}
	});
	tokenInput.addEventListener('focus', () => {
		tokenFocused = true;
		renderSuggestions();
	});
	tokenInput.addEventListener('blur', () => {
		tokenFocused = false;
		closeList();
	});
	tokenInput.addEventListener('input', () => {
		active = 0;
		renderSuggestions();
	});
	tokenInput.addEventListener('keydown', (event) => {
		if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
		const hasOptions = suggestions.length > 0;
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				if (!hasOptions) return renderSuggestions();
				event.preventDefault();
				setActive(
					(active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length
				);
				return;
			case 'Enter':
				if (hasOptions) {
					event.preventDefault();
					pick(suggestions[active]!);
				} else if (tokenInput.value.trim()) event.preventDefault();
				// An empty token field lets Enter submit the form.
				return;
			case 'Tab':
			case ',':
				if (hasOptions && tokenInput.value.trim()) {
					event.preventDefault();
					pick(suggestions[active]!);
				}
				return;
			case 'Backspace':
				if (!tokenInput.value && tokens.length) {
					event.preventDefault();
					tokens = tokens.slice(0, -1);
					renderTokens();
				}
				return;
		}
	});
	title.addEventListener('input', () => {
		if (title.value.trim()) {
			title.removeAttribute('aria-invalid');
			if (status.classList.contains('error')) setStatus('');
		}
	});
	panel.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			form.requestSubmit();
			return;
		}
		if (event.key !== 'Escape' || event.isComposing) return;
		if (tokenInput.value || !suggest.hidden) {
			// The first Escape clears the token text; the next one closes the panel.
			event.preventDefault();
			event.stopPropagation();
			tokenInput.value = '';
			closeList();
			return;
		}
		if (compact) {
			event.preventDefault();
			dismiss();
		}
	});
	dismissButton.addEventListener('click', dismiss);
	if (compact || !title.value) title.focus();
	else tokenInput.focus();

	type CatalogAnswer = Catalog & { error?: string; cached?: boolean };
	const catalogResponse = (await message<CatalogAnswer>({ type: 'catalog' })) ?? {
		tags: [],
		people: []
	};
	if (catalogResponse.error) {
		const needsPairing = catalogResponse.error.includes('Connect the extension from Prism');
		setStatus(
			needsPairing ? 'Connect from the Prism toolbar popup first.' : catalogResponse.error,
			!needsPairing
		);
		submit.disabled = true;
		tokenInput.disabled = true;
		tokenInput.placeholder = '';
		// The popup has its own Disconnect control in its footer.
		if (!needsPairing && compact) {
			const disconnect = document.createElement('button');
			disconnect.type = 'button';
			disconnect.className = 'quiet';
			disconnect.textContent = 'Disconnect';
			disconnect.addEventListener('click', async () => {
				await message({ type: 'disconnect' });
				dismiss();
			});
			dismissButton.after(disconnect);
		}
	} else {
		catalog = catalogResponse;
		catalogReady = true;
		tokenInput.disabled = state !== 'idle';
		renderTokens();
		renderSuggestions();
		// The stored copy answered instantly; now catch up with anything made in Prism since.
		if (catalogResponse.cached)
			void message<CatalogAnswer>({ type: 'catalog', fresh: true })
				.then((fresh) => {
					if (!fresh || fresh.error) return;
					catalog = { tags: fresh.tags, people: fresh.people };
					// A tag typed as new may exist now; the server matches it by name either way.
					if (state === 'idle') renderSuggestions();
				})
				.catch(() => {});
	}

	function complete(already: boolean) {
		clearTimeout(queuedTimer);
		setState('saved', already ? 'Already saved' : 'Saved');
		dismissButton.textContent = 'Close';
		setStatus(
			compact
				? already
					? 'Already in your Prism library.'
					: 'Saved to Prism.'
				: 'Sent to Prism. It finishes saving in the background.'
		);
		root.dispatchEvent(new CustomEvent('prism-saved'));
		if (compact) closeTimer = setTimeout(dismiss, 900);
	}
	function fail(error: string) {
		clearTimeout(queuedTimer);
		setState('idle');
		setStatus(error, true);
	}

	const onSaveResult = (raw: unknown) => {
		const result = raw as SaveResultMessage;
		if (result?.type !== 'save-result' || result.operationId !== activeOperationId) return;
		if (state === 'saved') return;
		if (result.error) fail(result.error);
		else complete(result.status === 'already_exists');
	};
	browser.runtime.onMessage.addListener(onSaveResult);
	const dispose = () => {
		clearTimeout(queuedTimer);
		clearTimeout(closeTimer);
		browser.runtime.onMessage.removeListener(onSaveResult);
	};
	root.addEventListener('prism-dispose', dispose, { once: true });

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (state !== 'idle' || submit.disabled || !catalogReady) return;
		const titleValue = title.value.trim();
		if (!titleValue) {
			title.setAttribute('aria-invalid', 'true');
			setStatus('Add a title to save this.', true);
			title.focus();
			return;
		}
		const person = tokens.find((token) => token.kind === 'person');
		const newTags = tokens.flatMap((token) =>
			token.kind === 'new-tag' ? [{ id: token.item.id, name: token.item.name }] : []
		);
		const operationId = crypto.randomUUID();
		const input: SaveInput = {
			protocolVersion: 1,
			operationId,
			command: {
				type: 'extension.bookmark.create',
				id: crypto.randomUUID(),
				kind: capture.kind,
				title: titleValue,
				url: capture.url,
				tagIds: tokens.flatMap((token) => (token.kind === 'tag' ? [token.item.id] : [])),
				...(newTags.length ? { newTags } : {}),
				...(person ? { person: { id: person.item.id } } : {})
			}
		};
		activeOperationId = operationId;
		setState('saving');
		setStatus('');
		try {
			const result = await message<{ queued?: boolean; error?: string }>({ type: 'save', input });
			if (result?.error) throw new Error(result.error);
			if (!result?.queued) throw new Error('Prism could not queue this bookmark.');
			if ((state as SaveState) !== 'saving') return; // A save-result already arrived.
			if (!compact) {
				// The background only reports results to tabs, so the popup treats "queued" as done.
				complete(false);
				return;
			}
			queuedTimer = setTimeout(() => {
				if (state !== 'saving') return;
				setState('queued');
				dismissButton.textContent = 'Close';
				setStatus('Queued. Prism will finish saving in the background.');
			}, 4000);
		} catch (error) {
			fail((error as Error).message);
		}
	});

	return panel;
}
