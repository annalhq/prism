import {
	MAX_BULK_BOOKMARKS,
	type BookmarkCommand,
	type BulkBookmarkCommand,
	type Command
} from './contracts.js';
import { normalizeUrl } from './urls.js';
import { NoteValidationError, validateNoteBody } from './notes.js';
import {
	isOrganizationCommand,
	parseOrganizationCommand,
	parseBookmarkOrganization
} from './organization.js';

export { ValidationError, object, keys, uuid } from './validation-fields.js';
import { ValidationError, object, keys, uuid, text, revision } from './validation-fields.js';

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
	if (c.type === 'bookmark.organize') {
		keys(c, ['type', 'id', 'expectedRevision', 'patch']);
		return { type: c.type, id, expectedRevision, patch: parseBookmarkOrganization(c.patch) };
	}
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
	if (typeof c.type === 'string' && isOrganizationCommand({ type: c.type }))
		return parseOrganizationCommand(c);
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
	const commands: BulkBookmarkCommand[] = c.commands.map((value) => {
		const item = object(value);
		if (item.type === 'tag.add' || item.type === 'tag.remove') {
			const parsed = parseOrganizationCommand(item);
			if (parsed.type === 'tag.add' || parsed.type === 'tag.remove') return parsed;
		}
		return bookmark(item);
	});
	if (new Set(commands.map((c) => c.id)).size !== commands.length)
		throw new ValidationError('Each bookmark can occur only once in a bulk command.');
	return { type: c.type, commands };
}
