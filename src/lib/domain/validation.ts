import {
	MAX_BULK_BOOKMARKS,
	type BookmarkCommand,
	type Command,
	type Revision
} from './contracts.js';
import { normalizeUrl } from './urls.js';
import { NoteValidationError, validateNoteBody } from './notes.js';

export class ValidationError extends Error {}
export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ValidationError('Expected an object.');
	return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		throw new ValidationError('Unknown field.');
}
export function uuid(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
	)
		throw new ValidationError('Expected a UUID.');
	return value.toLowerCase();
}
function text(value: unknown, max: number, required = false): string {
	if (
		typeof value !== 'string' ||
		!value.isWellFormed() ||
		value.includes('\0') ||
		[...value].length > max ||
		(required && !value.trim())
	)
		throw new ValidationError(
			`Expected ${required ? 'nonempty ' : ''}text of at most ${max} characters.`
		);
	return value;
}
function url(value: unknown): string | null {
	if (value === null) return null;
	const input = text(value, 8192);
	try {
		normalizeUrl(input);
	} catch (error) {
		throw new ValidationError((error as Error).message);
	}
	return input;
}
function revision(value: unknown): Revision {
	if (
		typeof value !== 'string' ||
		!/^[1-9]\d{0,18}$/.test(value) ||
		BigInt(value) > 9223372036854775807n
	)
		throw new ValidationError('Expected a positive decimal revision within signed bigint range.');
	return value as Revision;
}
function bookmark(value: unknown): BookmarkCommand {
	const c = object(value);
	const id = uuid(c.id);
	if (c.type === 'bookmark.create') {
		keys(c, ['type', 'id', 'kind', 'title', 'description', 'url']);
		if (typeof c.kind !== 'string' || !['page', 'social', 'image'].includes(c.kind))
			throw new ValidationError('Unknown bookmark kind.');
		const inputUrl = c.url === undefined ? null : url(c.url);
		if (c.kind !== 'image' && inputUrl === null)
			throw new ValidationError('Page and social bookmarks require a URL.');
		return {
			type: c.type,
			id,
			kind: c.kind as 'page' | 'social' | 'image',
			title: text(c.title, 500, true),
			description: c.description === undefined ? '' : text(c.description, 10000),
			url: inputUrl
		};
	}
	const expectedRevision = revision(c.expectedRevision);
	if (c.type === 'bookmark.update') {
		keys(c, ['type', 'id', 'expectedRevision', 'patch']);
		const p = object(c.patch);
		keys(p, ['title', 'description', 'url']);
		if (!Object.keys(p).length)
			throw new ValidationError('An update must include a writable field.');
		return {
			type: c.type,
			id,
			expectedRevision,
			patch: {
				...('title' in p ? { title: text(p.title, 500, true) } : {}),
				...('description' in p ? { description: text(p.description, 10000) } : {}),
				...('url' in p ? { url: url(p.url) } : {})
			}
		};
	}
	if (c.type === 'bookmark.trash' || c.type === 'bookmark.restore' || c.type === 'bookmark.purge') {
		keys(c, ['type', 'id', 'expectedRevision']);
		return { type: c.type, id, expectedRevision };
	}
	throw new ValidationError('Unknown bookmark command.');
}
export function parseCommand(value: unknown): Command {
	const c = object(value);
	if (c.type === 'note.replace') {
		keys(c, ['type', 'id', 'expectedRevision', 'bodyMarkdown']);
		try {
			return {
				type: c.type,
				id: uuid(c.id),
				expectedRevision: c.expectedRevision === '0' ? '0' : revision(c.expectedRevision),
				bodyMarkdown: validateNoteBody(c.bodyMarkdown)
			};
		} catch (error) {
			if (error instanceof NoteValidationError) throw new ValidationError(error.message);
			throw error;
		}
	}
	if (c.type === 'related-link.add' || c.type === 'related-link.remove') {
		keys(c, ['type', 'id', 'expectedRevision', 'target']);
		const target = object(c.target);
		keys(target, ['kind', 'id']);
		if (target.kind !== 'bookmark' && target.kind !== 'person' && target.kind !== 'persona')
			throw new ValidationError('Unknown related target kind.');
		return {
			type: c.type,
			id: uuid(c.id),
			expectedRevision: revision(c.expectedRevision),
			target: { kind: target.kind, id: uuid(target.id) }
		};
	}
	if (c.type !== 'bookmark.bulk') return bookmark(c);
	keys(c, ['type', 'commands']);
	if (!Array.isArray(c.commands) || !c.commands.length || c.commands.length > MAX_BULK_BOOKMARKS)
		throw new ValidationError(`Bulk commands require 1–${MAX_BULK_BOOKMARKS} bookmarks.`);
	const commands = c.commands.map(bookmark);
	if (new Set(commands.map((c) => c.id)).size !== commands.length)
		throw new ValidationError('Each bookmark can occur only once in a bulk command.');
	return { type: c.type, commands };
}
