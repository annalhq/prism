import type { EntityRef } from '#lib/domain/entities.js';
import {
	childNodes,
	parseMarkdown,
	plainText,
	type MarkdownNode,
	type MarkdownRoot
} from '#lib/domain/markdown.js';
import { extractReferences, parseReference } from '#lib/domain/notes.js';

// The parser has no source positions, so a source edit is proposed as plain text surgery and
// kept only when re-parsing proves it changed exactly what was intended. Anything the proof
// rejects (code, HTML, escapes, look-alike text) stays byte-for-byte as written.

type Edit = { start: number; end: number; text: string };

const isTarget = (node: MarkdownNode, target: string) => {
	if (node.type !== 'link') return false;
	const ref = parseReference(node.href);
	return !!ref && `${ref.kind}/${ref.id}` === target;
};

function countTargets(tree: MarkdownRoot, target: string): number {
	let count = 0;
	const visit = (node: MarkdownNode) => {
		if (isTarget(node, target)) count++;
		childNodes(node).forEach(visit);
	};
	visit(tree);
	return count;
}

/** The tree with links to `target` unwrapped and adjacent text merged, as a comparable string. */
function withoutTarget(tree: MarkdownRoot, target: string): string {
	const unwrap = (node: MarkdownNode): unknown => {
		const copy: Record<string, unknown> = { ...node };
		for (const key of ['children', 'items'] as const) {
			const value = (node as unknown as Record<string, unknown>)[key];
			if (!Array.isArray(value)) continue;
			const out: unknown[] = [];
			const push = (child: MarkdownNode) => {
				if (isTarget(child, target)) {
					childNodes(child).forEach(push);
					return;
				}
				const last = out.at(-1) as { type?: string; value?: string } | undefined;
				if (child.type === 'text' && last?.type === 'text') last.value += child.value;
				else out.push(unwrap(child));
			};
			value.forEach(push);
			copy[key] = out;
		}
		if (node.type === 'table') {
			copy.header = node.header.map(unwrap);
			copy.rows = node.rows.map((row) => row.map(unwrap));
		}
		return copy;
	};
	return JSON.stringify(unwrap(tree));
}

const escaped = (source: string, index: number) => {
	let slashes = 0;
	while (index - slashes - 1 >= 0 && source[index - slashes - 1] === '\\') slashes++;
	return slashes % 2 === 1;
};

/** Index of the `[` matching the `]` at `close`, or -1. */
function openingBracket(source: string, close: number): number {
	let depth = 0;
	for (let i = close; i >= 0; i--) {
		if (escaped(source, i)) continue;
		if (source[i] === ']') depth++;
		else if (source[i] === '[' && --depth === 0) return i;
		else if (source[i] === '\n' && source[i - 1] === '\n') return -1; // labels end at a blank line
	}
	return -1;
}

/** End (exclusive) of an inline link's `(…)` tail starting after the destination, or -1. */
function inlineTail(source: string, from: number): number {
	let i = from;
	while (source[i] === ' ' || source[i] === '\t' || source[i] === '\n') i++;
	const quote = source[i];
	if (quote === '"' || quote === "'" || quote === '(') {
		const closer = quote === '(' ? ')' : quote;
		for (i++; i < source.length; i++) {
			if (source[i] === closer && !escaped(source, i)) break;
		}
		if (i >= source.length) return -1;
		i++;
		while (source[i] === ' ' || source[i] === '\t' || source[i] === '\n') i++;
	}
	return source[i] === ')' ? i + 1 : -1;
}

const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Candidate link spans to `target`, as edits replacing each with its label source. */
function linkCandidates(body: string, target: string): Edit[] {
	const [kind, id] = target.split('/');
	const edits: Edit[] = [];
	const destination = new RegExp(`prism:${escapeRegExp(kind)}/${escapeRegExp(id)}`, 'gi');
	// Inline links: [label](prism:kind/id …) and [label](<prism:kind/id> …)
	for (const match of body.matchAll(destination)) {
		let at = match.index;
		const angle = body[at - 1] === '<';
		if (angle) at--;
		if (body[at - 1] !== '(' || body[at - 2] !== ']') continue;
		const close = at - 2;
		const open = openingBracket(body, close);
		let after = match.index + match[0].length;
		if (angle) {
			if (body[after] !== '>') continue;
			after++;
		}
		const end = inlineTail(body, after);
		if (open < 0 || end < 0) continue;
		edits.push({ start: open, end, text: body.slice(open + 1, close) });
	}
	// Reference-style links whose definition points at the target.
	const labels = new Set<string>();
	const definition = new RegExp(
		`^ {0,3}\\[((?:[^\\]\\\\]|\\\\.)+)\\]:[ \\t]*<?prism:${escapeRegExp(kind)}/${escapeRegExp(id)}>?(?=\\s|$)`,
		'gim'
	);
	for (const match of body.matchAll(definition)) labels.add(normalizeLabel(match[1]));
	if (labels.size) {
		const reference = /\[((?:[^\]\\]|\\.)*)\](?:\[((?:[^\]\\]|\\.)*)\])?(?![(:])/g;
		for (const match of body.matchAll(reference)) {
			if (escaped(body, match.index)) continue;
			const label = match[2] === undefined || match[2] === '' ? match[1] : match[2];
			if (labels.has(normalizeLabel(label)))
				edits.push({ start: match.index, end: match.index + match[0].length, text: match[1] });
		}
	}
	return edits;
}

/** Unlinks every proven link to `target` (`kind/id`), keeping its label as written. */
export function removeNoteReference(body: string, target: string): string {
	let tree = parseMarkdown(body);
	let remaining = countTargets(tree, target);
	if (!remaining) return body;
	const candidates = linkCandidates(body, target).sort((a, b) => b.start - a.start);
	let floor = Infinity;
	for (const edit of candidates) {
		// Right to left, non-overlapping: earlier offsets stay valid as later text changes.
		if (edit.end > floor || !remaining) continue;
		const next = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
		const nextTree = parseMarkdown(next);
		const nextCount = countTargets(nextTree, target);
		if (
			nextCount === remaining - 1 &&
			withoutTarget(nextTree, target) === withoutTarget(tree, target)
		) {
			body = next;
			tree = nextTree;
			remaining = nextCount;
			floor = edit.start;
		}
	}
	return body;
}

const START = '<!-- prism:links:v1 -->',
	END = '<!-- /prism:links:v1 -->';
export type NoteLink = { ref: EntityRef; label: string };

// Raw HTML is plain text to the parser, so a marker is a paragraph holding exactly its comment.
const isMarker = (node: MarkdownNode | undefined, marker: string) =>
	node?.type === 'paragraph' &&
	node.children.length === 1 &&
	node.children[0].type === 'text' &&
	node.children[0].value === marker;

/** The generated link block's links, if `nodes` is exactly [START, link paragraphs…, END]. */
function blockLinks(nodes: readonly MarkdownNode[]): NoteLink[] | null {
	if (nodes.length < 2 || !isMarker(nodes[0], START) || !isMarker(nodes.at(-1), END)) return null;
	const links: NoteLink[] = [];
	for (const node of nodes.slice(1, -1)) {
		if (node.type !== 'paragraph') return null;
		for (const child of node.children) {
			if (child.type === 'text' && !child.value.trim()) continue;
			if (child.type !== 'link') return null;
			const ref = parseReference(child.href);
			if (!ref) return null;
			links.push({ ref, label: plainText(child) });
		}
	}
	return links;
}

export function splitLinkedNote(body: string): { text: string; links: NoteLink[] } {
	const none = { text: body, links: [] };
	// Most notes have no generated block; skip parsing them.
	if (!body.trimEnd().endsWith(END)) return none;
	const nodes = parseMarkdown(body).children;
	const startIndex = nodes.findLastIndex((n) => isMarker(n, START));
	if (startIndex < 0 || !blockLinks(nodes.slice(startIndex))) return none;
	// The block is the note's tail: its marker is the last line-start occurrence whose remainder
	// parses as the same block.
	let offset = body.lastIndexOf(START);
	while (offset > 0 && body[offset - 1] !== '\n') offset = body.lastIndexOf(START, offset - 1);
	if (offset < 0) return none;
	const links = blockLinks(parseMarkdown(body.slice(offset)).children);
	if (!links) return none;
	// Strip only the generated separator, preserving the user's own whitespace.
	const prefix = body.slice(0, offset);
	return { text: prefix.endsWith('\n\n') ? prefix.slice(0, -2) : prefix, links };
}
export function joinLinkedNote(text: string, links: NoteLink[]): string {
	if (!links.length) return text;
	return `${text}\n\n${START}\n\n${links.map((l) => `[${l.label.replace(/[[\]\\]/g, '\\$&')}](prism:${l.ref.kind}/${l.ref.id})`).join('\n')}\n\n${END}`;
}
export function addNoteLink(body: string, ref: EntityRef, label: string): string {
	if (extractReferences(body).some((r) => r.kind === ref.kind && r.id === ref.id)) return body;
	const note = splitLinkedNote(body);
	return joinLinkedNote(note.text, [...note.links, { ref, label }]);
}
export function removeLinkedNoteReference(body: string, target: string): string {
	const note = splitLinkedNote(body);
	return joinLinkedNote(
		removeNoteReference(note.text, target),
		note.links.filter((l) => `${l.ref.kind}/${l.ref.id}` !== target)
	);
}
/**
 * A note as previewed in lists: the user's text without the generated link block. Render it with
 * `renderNotePreview`, which shows Prism links as their text without editing the source.
 */
export function notePreview(body: string): string {
	return splitLinkedNote(body).text;
}
