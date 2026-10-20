import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import { parseReference } from '#lib/domain/notes.js';
export function removeNoteReference(body: string, target: string): string {
	const tree = fromMarkdown(body);
	const definitions = new Map<string, string>();
	const visit = (node: Nodes, callback: (node: Nodes) => void) => {
		callback(node);
		if ('children' in node) for (const child of node.children) visit(child, callback);
	};
	visit(tree, (n) => {
		if (n.type === 'definition') definitions.set(n.identifier, n.url);
	});
	const edits: { start: number; end: number; text: string }[] = [];
	const plain = (node: Nodes): string =>
		'value' in node
			? String(node.value)
			: 'children' in node
				? node.children.map(plain).join('')
				: '';
	visit(tree, (node) => {
		const url =
			node.type === 'link'
				? node.url
				: node.type === 'linkReference'
					? definitions.get(node.identifier)
					: undefined;
		const ref = url ? parseReference(url) : null;
		if (
			ref &&
			`${ref.kind}/${ref.id}` === target &&
			node.position?.start.offset !== undefined &&
			node.position.end.offset !== undefined
		)
			edits.push({
				start: node.position.start.offset,
				end: node.position.end.offset,
				text: plain(node)
			});
	});
	for (const edit of edits.sort((a, b) => b.start - a.start))
		body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
	return body;
}

import type { EntityRef } from '#lib/domain/entities.js';
import { extractReferences } from '#lib/domain/notes.js';
const START = '<!-- prism:links:v1 -->',
	END = '<!-- /prism:links:v1 -->';
export type NoteLink = { ref: EntityRef; label: string };
const textOf = (node: Nodes): string =>
	'value' in node
		? String(node.value)
		: 'children' in node
			? node.children.map(textOf).join('')
			: '';
export function splitLinkedNote(body: string): { text: string; links: NoteLink[] } {
	const tree = fromMarkdown(body),
		nodes = tree.children;
	const end = nodes.at(-1);
	if (end?.type !== 'html' || end.value !== END) return { text: body, links: [] };
	const startIndex = nodes.findLastIndex((n) => n.type === 'html' && n.value === START);
	if (startIndex < 0) return { text: body, links: [] };
	const start = nodes[startIndex];
	const links: NoteLink[] = [];
	for (const node of nodes.slice(startIndex + 1, -1)) {
		if (node.type !== 'paragraph') return { text: body, links: [] };
		for (const child of node.children) {
			if (child.type === 'text' && !child.value.trim()) continue;
			if (child.type !== 'link') return { text: body, links: [] };
			const ref = parseReference(child.url);
			if (!ref) return { text: body, links: [] };
			links.push({ ref, label: textOf(child) });
		}
	}
	const offset = start.position?.start.offset;
	if (offset === undefined) return { text: body, links: [] };
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
export function notePreview(body: string): string {
	let text = splitLinkedNote(body).text;
	for (const ref of extractReferences(text))
		text = removeNoteReference(text, `${ref.kind}/${ref.id}`);
	return text;
}
