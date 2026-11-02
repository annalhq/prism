import type { Attachment } from 'svelte/attachments';

// The usual Markdown shortcuts in a plain textarea, with no toolbar:
//   ⌘/Ctrl+B bold · ⌘/Ctrl+I italic · ⌘/Ctrl+Shift+X strikethrough · ⌘/Ctrl+E inline code
//   ⌘/Ctrl+K link
// Each wraps the selection (or the word at the caret), and pressing it again unwraps. Edits go
// through the browser's own insertText, so undo and redo keep working and input events fire.

type Wrap = { before: string; after: string };
const WRAPS: Record<string, Wrap> = {
	b: { before: '**', after: '**' },
	i: { before: '*', after: '*' },
	x: { before: '~~', after: '~~' },
	e: { before: '`', after: '`' }
};

function replace(node: HTMLTextAreaElement, start: number, end: number, text: string) {
	node.focus();
	node.setSelectionRange(start, end);
	// insertText keeps the edit on the undo stack; fall back where it isn't supported.
	if (!document.execCommand?.('insertText', false, text)) {
		node.setRangeText(text, start, end, 'end');
		node.dispatchEvent(new Event('input', { bubbles: true }));
	}
}

/** The selection, or the word around the caret when nothing is selected. */
function target(node: HTMLTextAreaElement) {
	let { selectionStart: start, selectionEnd: end } = node;
	const value = node.value;
	if (start === end) {
		while (start > 0 && /[\p{L}\p{N}_'-]/u.test(value[start - 1])) start--;
		while (end < value.length && /[\p{L}\p{N}_'-]/u.test(value[end])) end++;
	}
	return { start, end, text: value.slice(start, end) };
}

function wrap(node: HTMLTextAreaElement, { before, after }: Wrap) {
	const { start, end, text } = target(node);
	const value = node.value;
	// Already wrapped, inside or just outside the selection: unwrap.
	if (
		text.startsWith(before) &&
		text.endsWith(after) &&
		text.length >= before.length + after.length
	) {
		const inner = text.slice(before.length, text.length - after.length);
		replace(node, start, end, inner);
		node.setSelectionRange(start, start + inner.length);
		return;
	}
	if (
		value.slice(start - before.length, start) === before &&
		value.slice(end, end + after.length) === after
	) {
		replace(node, start - before.length, end + after.length, text);
		node.setSelectionRange(start - before.length, end - before.length);
		return;
	}
	replace(node, start, end, `${before}${text}${after}`);
	// Keep the wrapped text selected; with nothing selected, leave the caret between the marks.
	node.setSelectionRange(start + before.length, start + before.length + text.length);
}

function link(node: HTMLTextAreaElement) {
	const { start, end, text } = target(node);
	const isUrl = /^https?:\/\/\S+$/.test(text);
	const label = isUrl ? '' : text;
	const url = isUrl ? text : 'https://';
	replace(node, start, end, `[${label}](${url})`);
	// Select what's left to type: the label for a pasted URL, otherwise the address.
	if (isUrl) node.setSelectionRange(start + 1, start + 1);
	else node.setSelectionRange(start + label.length + 3, start + label.length + 3 + url.length);
}

export const markdownShortcuts: Attachment<HTMLTextAreaElement> = (node) => {
	const keydown = (event: KeyboardEvent) => {
		if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
		const key = event.key.toLowerCase();
		if (key === 'k' && !event.shiftKey) {
			event.preventDefault();
			link(node);
			return;
		}
		// Strikethrough needs Shift (⌘X alone is cut); the rest must be without it.
		if (key === 'x' ? !event.shiftKey : event.shiftKey) return;
		const shape = WRAPS[key];
		if (!shape) return;
		event.preventDefault();
		event.stopPropagation();
		wrap(node, shape);
	};
	node.addEventListener('keydown', keydown);
	return () => node.removeEventListener('keydown', keydown);
};
