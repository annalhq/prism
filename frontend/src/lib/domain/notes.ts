import { parseMarkdown, renderSafeMarkdown, walk, type MarkdownRoot } from './markdown.js';

export const MAX_NOTE_BYTES = 102_400;
export const MAX_NOTE_REFERENCES = 200;
import type { EntityKind, EntityRef } from './entities.js';
export type { EntityKind } from './entities.js';
export type EntityReference = EntityRef;
export class NoteValidationError extends Error {}

export function parseReference(destination: string): EntityReference | null {
	const match =
		/^prism:(bookmark|person|persona)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
			destination
		);
	return match ? { kind: match[1].toLowerCase() as EntityKind, id: match[2].toLowerCase() } : null;
}

function references(tree: MarkdownRoot): EntityReference[] {
	const found = new Map<string, EntityReference>();
	// Reference-style links arrive resolved against their definitions; code and HTML are skipped.
	walk(tree, (node) => {
		const reference = node.type === 'link' ? parseReference(node.href) : null;
		if (reference) found.set(`${reference.kind}/${reference.id}`, reference);
	});
	return [...found.values()].sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
	);
}
export function extractReferences(markdown: string): EntityReference[] {
	return references(parseMarkdown(markdown));
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
// destinations remain typed Prism links for the editor's navigation handler.
export function renderNote(markdown: string): string {
	return renderSafeMarkdown(markdown, { safeUrl: isSafeNoteUrl, internalLinks: 'link' });
}

// A list or card preview: the same policy, with Prism links shown as their text.
export function renderNotePreview(markdown: string): string {
	return renderSafeMarkdown(markdown, { safeUrl: isSafeNoteUrl, internalLinks: 'text' });
}

export function noteSnippet(markdown: string, max = 240, targetId?: string): string {
	const tree = parseMarkdown(markdown);
	const text: string[] = [];
	let length = 0;
	let anchor: number | undefined;
	walk(tree, (node) => {
		const url = node.type === 'link' ? node.href : undefined;
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
