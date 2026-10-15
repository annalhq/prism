import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';
import type { Root, Nodes } from 'mdast';

export const MAX_NOTE_BYTES = 102_400;
export const MAX_NOTE_REFERENCES = 200;
export type EntityKind = 'bookmark' | 'person' | 'persona';
export type EntityReference = { kind: EntityKind; id: string };
export class NoteValidationError extends Error {}

export function parseReference(destination: string): EntityReference | null {
	const match =
		/^prism:(bookmark|person|persona)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
			destination
		);
	return match ? { kind: match[1].toLowerCase() as EntityKind, id: match[2].toLowerCase() } : null;
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
	visit(node);
	// Code and HTML nodes have no Markdown children; their contents are never reparsed.
	if ('children' in node) for (const child of node.children) walk(child, visit);
}
function definitions(tree: Root): Map<string, string> {
	const result = new Map<string, string>();
	walk(tree, (node) => {
		if (node.type === 'definition' && !result.has(node.identifier))
			result.set(node.identifier, node.url);
	});
	return result;
}
function references(tree: Root): EntityReference[] {
	const defs = definitions(tree);
	const found = new Map<string, EntityReference>();
	walk(tree, (node) => {
		const url =
			node.type === 'link'
				? node.url
				: node.type === 'linkReference'
					? defs.get(node.identifier)
					: undefined;
		const reference = url ? parseReference(url) : null;
		if (reference) found.set(`${reference.kind}/${reference.id}`, reference);
	});
	return [...found.values()].sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
	);
}
export function extractReferences(markdown: string): EntityReference[] {
	return references(fromMarkdown(markdown));
}
export function validateNoteBody(body: unknown): string {
	if (typeof body !== 'string' || !body.isWellFormed() || body.includes('\0'))
		throw new NoteValidationError('Expected well-formed Markdown text without NUL.');
	if (new TextEncoder().encode(body).byteLength > MAX_NOTE_BYTES)
		throw new NoteValidationError('Notes must be at most 100 KiB of UTF-8 text.');
	if (extractReferences(body).length > MAX_NOTE_REFERENCES)
		throw new NoteValidationError(
			'Notes may reference at most 200 distinct targets, including self-links.'
		);
	return body;
}

export function isSafeNoteUrl(url: string): boolean {
	if (parseReference(url)) return true;
	try {
		const parsed = new URL(url);
		return (
			['http:', 'https:', 'mailto:'].includes(parsed.protocol) &&
			!parsed.username &&
			!parsed.password
		);
	} catch {
		return false;
	}
}

// No raw HTML, remote image requests, relative URLs or arbitrary protocols. Internal
// destinations remain typed Prism links for the future reader's navigation handler.
export function renderNote(markdown: string): string {
	const tree = fromMarkdown(markdown);
	const defs = definitions(tree);
	const clean = (node: Nodes): void => {
		if (!('children' in node)) return;
		node.children = (node.children as Nodes[]).flatMap<Nodes>((child) => {
			if (child.type === 'html' || child.type === 'definition') return [];
			if (child.type === 'image' || child.type === 'imageReference')
				return [{ type: 'text' as const, value: child.alt ?? '' }];
			clean(child);
			const url =
				child.type === 'link'
					? child.url
					: child.type === 'linkReference'
						? defs.get(child.identifier)
						: undefined;
			if (child.type === 'link' || child.type === 'linkReference') {
				if (!url || !isSafeNoteUrl(url)) return child.children;
				return [{ type: 'link' as const, url, children: child.children }];
			}
			return [child];
		}) as typeof node.children;
	};
	clean(tree);
	return toHtml(toHast(tree));
}

export function noteSnippet(markdown: string, max = 240, targetId?: string): string {
	const tree = fromMarkdown(markdown);
	const defs = definitions(tree);
	const text: string[] = [];
	let length = 0;
	let anchor: number | undefined;
	walk(tree, (node) => {
		const url =
			node.type === 'link'
				? node.url
				: node.type === 'linkReference'
					? defs.get(node.identifier)
					: undefined;
		if (targetId && anchor === undefined && url && parseReference(url)?.id === targetId)
			anchor = length;
		if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
			const value = node.value.replace(/\s+/g, ' ');
			text.push(value);
			length += [...value].length + 1;
		}
	});
	const start = Math.max(0, (anchor ?? 0) - Math.floor(max / 3));
	return [...text.join(' ')]
		.slice(start, start + max)
		.join('')
		.trim();
}
