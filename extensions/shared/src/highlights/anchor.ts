import type { Highlight } from '../protocol';

/**
 * Finding passages in a page. The page's text is read as one string from its text nodes, with
 * every run of whitespace collapsed to a single space, so a highlight survives the reflowed
 * markup and re-indented source that come with most site updates. A saved highlight keeps a
 * little of the text on either side; on a later visit the passage is found by that context
 * first, then by the closest-matching occurrence of the passage itself.
 */

export const CONTEXT_LENGTH = 32;
export const MAX_HIGHLIGHT_LENGTH = 5000;
const MAX_DESCRIPTION_LENGTH = 10000;

const skipped = new Set([
	'SCRIPT',
	'STYLE',
	'NOSCRIPT',
	'TEXTAREA',
	'TEMPLATE',
	'IFRAME',
	'OBJECT'
]);
const whitespace = /\s/;

export type TextIndex = {
	/** The page's text, whitespace collapsed. */
	text: string;
	nodes: Text[];
	/** Where each node's text starts in `text`. */
	starts: number[];
	/** Whether `text` ends in a space just before each node, so its leading space is dropped. */
	afterSpace: boolean[];
};

export function buildIndex(root: Node = document.body): TextIndex {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement && skipped.has(node.parentElement.tagName)
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT
	});
	const parts: string[] = [];
	const nodes: Text[] = [];
	const starts: number[] = [];
	const afterSpace: boolean[] = [];
	let length = 0;
	let space = true; // Leading whitespace on the page is dropped.
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		let part = text.data.replace(/\s+/g, ' ');
		nodes.push(text);
		starts.push(length);
		afterSpace.push(space);
		if (space && part.startsWith(' ')) part = part.slice(1);
		if (!part) continue;
		parts.push(part);
		length += part.length;
		space = part.endsWith(' ');
	}
	return { text: parts.join(''), nodes, starts, afterSpace };
}

/** The offset in `index.text` of a position inside node `i`. */
function indexOffset(index: TextIndex, i: number, raw: number): number {
	const data = index.nodes[i]!.data;
	let emitted = 0;
	let space = index.afterSpace[i]!;
	for (let k = 0; k < raw && k < data.length; k++) {
		const ws = whitespace.test(data[k]!);
		if (ws && space) continue;
		emitted++;
		space = ws;
	}
	return index.starts[i]! + emitted;
}

/** The node position of the character at `offset` in `index.text`. */
function nodePosition(index: TextIndex, offset: number): { node: Text; offset: number } | null {
	// The last node starting at or before the offset that has text of its own.
	let low = 0;
	let high = index.nodes.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (index.starts[mid]! <= offset) low = mid;
		else high = mid - 1;
	}
	for (let i = low; i >= 0; i--) {
		const end = index.starts[i + 1] ?? index.text.length;
		if (index.starts[i]! > offset || offset >= end) continue;
		const data = index.nodes[i]!.data;
		const target = offset - index.starts[i]!;
		let emitted = 0;
		let space = index.afterSpace[i]!;
		for (let k = 0; k < data.length; k++) {
			const ws = whitespace.test(data[k]!);
			if (ws && space) continue;
			if (emitted === target) return { node: index.nodes[i]!, offset: k };
			emitted++;
			space = ws;
		}
	}
	return null;
}

function rangeAt(index: TextIndex, start: number, end: number): Range | null {
	const from = nodePosition(index, start);
	const to = nodePosition(index, end - 1);
	if (!from || !to) return null;
	const range = document.createRange();
	range.setStart(from.node, from.offset);
	range.setEnd(to.node, to.offset + 1);
	return range;
}

function commonPrefix(a: string, b: string) {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}
function commonSuffix(a: string, b: string) {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

/** Where a saved highlight is on this page now, or null when its text is gone. */
export function locate(index: TextIndex, highlight: Highlight): Range | null {
	const { text } = index;
	const passage = highlight.text;
	if (!passage) return null;
	const exact = text.indexOf(highlight.prefix + passage + highlight.suffix);
	if (exact >= 0) {
		const start = exact + highlight.prefix.length;
		return rangeAt(index, start, start + passage.length);
	}
	// The page changed around it: take the occurrence whose surroundings match best.
	let best = -1;
	let bestScore = -1;
	for (
		let at = text.indexOf(passage), seen = 0;
		at >= 0 && seen < 1000;
		at = text.indexOf(passage, at + 1), seen++
	) {
		const score =
			commonSuffix(text.slice(Math.max(0, at - highlight.prefix.length), at), highlight.prefix) +
			commonPrefix(
				text.slice(at + passage.length, at + passage.length + highlight.suffix.length),
				highlight.suffix
			);
		if (score > bestScore) {
			best = at;
			bestScore = score;
		}
	}
	return best < 0 ? null : rangeAt(index, best, best + passage.length);
}

/**
 * The current selection, read in the page when "Add to Prism" is chosen from the context menu:
 * the text as the reader sees it for the description, and the passage with its context for
 * finding it again. The passage is left out when it can't be saved (too long, or no text).
 */
export function readSelection(): { description: string; highlight?: Highlight } | null {
	const selection = getSelection();
	if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
	const description = selection
		.toString()
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.slice(0, MAX_DESCRIPTION_LENGTH);
	if (!description) return null;
	const range = selection.getRangeAt(0);
	const index = buildIndex();
	let start = -1;
	let end = -1;
	index.nodes.forEach((node, i) => {
		if (!range.intersectsNode(node)) return;
		const from = node === range.startContainer ? range.startOffset : 0;
		const to = node === range.endContainer ? range.endOffset : node.data.length;
		if (start < 0) start = indexOffset(index, i, from);
		end = indexOffset(index, i, to);
	});
	if (start < 0) return { description };
	while (start < end && index.text[start] === ' ') start++;
	while (end > start && index.text[end - 1] === ' ') end--;
	const text = index.text.slice(start, end);
	if (!text || text.length > MAX_HIGHLIGHT_LENGTH) return { description };
	return {
		description,
		highlight: {
			text,
			prefix: index.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
			suffix: index.text.slice(end, end + CONTEXT_LENGTH)
		}
	};
}

/** SHA-256 of a page's canonical URL, as Prism stores it (`new URL(url).href`). */
export async function urlHash(url: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(new URL(url).href));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
