import { caseFold } from 'unicode-case-folding';
import type { BookmarkProjection, Revision } from './contracts.js';
import {
	parseSearchFilter,
	parseSearchSort,
	type SearchFilter,
	type SearchSort
} from './search.js';
import { keys, object, revision, text, uuid, ValidationError } from './validation-fields.js';

export const MAX_ENTITY_TAGS = 50;
export type TaxonomyCommand =
	| { type: 'tag.create' | 'collection.create'; id: string; name: string }
	| {
			type: 'tag.rename' | 'collection.rename';
			id: string;
			expectedRevision: Revision;
			name: string;
	  }
	| { type: 'tag.delete' | 'collection.delete'; id: string; expectedRevision: Revision };
export type TagMembershipCommand = { type: 'tag.add' | 'tag.remove'; id: string; tagId: string };
export type BookmarkOrganization = {
	collectionId?: string | null;
	readingStatus?: 'unread' | 'reading' | 'read';
	isPinned?: boolean;
	isArchived?: boolean;
};
export type SavedSearchCommand =
	| {
			type: 'saved-search.create';
			id: string;
			name: string;
			filter: SearchFilter;
			sort: SearchSort;
	  }
	| {
			type: 'saved-search.update';
			id: string;
			expectedRevision: Revision;
			name: string;
			filter: SearchFilter;
			sort: SearchSort;
	  }
	| { type: 'saved-search.delete'; id: string; expectedRevision: Revision };
export type ActivityCommand = { type: 'activity.open'; id: string };
export type OrganizationCommand =
	TaxonomyCommand | TagMembershipCommand | SavedSearchCommand | ActivityCommand;
export const ORGANIZATION_COMMAND_TYPES = [
	'tag.create',
	'tag.rename',
	'tag.delete',
	'collection.create',
	'collection.rename',
	'collection.delete',
	'tag.add',
	'tag.remove',
	'saved-search.create',
	'saved-search.update',
	'saved-search.delete',
	'activity.open'
] as const;
export function isOrganizationCommand(value: { type: string }): value is OrganizationCommand {
	return (ORGANIZATION_COMMAND_TYPES as readonly string[]).includes(value.type);
}
export function normalizeOrganizationName(value: unknown): {
	name: string;
	normalizedName: string;
} {
	// Bound the normalized display form; surrounding/collapsed whitespace is not identity.
	const input = text(value, 1024).normalize('NFC').replace(/\s+/gu, ' ').trim();
	const name = text(input, 64, true);
	const normalizedName = caseFold(name).normalize('NFC');
	if ([...normalizedName].length > 256) throw new ValidationError('Normalized name is too long.');
	return { name, normalizedName };
}
export function parseBookmarkOrganization(value: unknown): BookmarkOrganization {
	const p = object(value);
	keys(p, ['collectionId', 'readingStatus', 'isPinned', 'isArchived']);
	if (!Object.keys(p).length)
		throw new ValidationError('Organization updates require a writable field.');
	const patch: BookmarkOrganization = {};
	if ('collectionId' in p)
		patch.collectionId = p.collectionId === null ? null : uuid(p.collectionId);
	if ('readingStatus' in p) {
		if (p.readingStatus !== 'unread' && p.readingStatus !== 'reading' && p.readingStatus !== 'read')
			throw new ValidationError('Unknown reading status.');
		patch.readingStatus = p.readingStatus;
	}
	for (const field of ['isPinned', 'isArchived'] as const) {
		if (field in p) {
			if (typeof p[field] !== 'boolean') throw new ValidationError('Expected a boolean.');
			patch[field] = p[field];
		}
	}
	return patch;
}
export function parseOrganizationCommand(value: unknown): OrganizationCommand {
	const c = object(value);
	const id = uuid(c.id);
	switch (c.type) {
		case 'tag.create':
		case 'collection.create':
			keys(c, ['type', 'id', 'name']);
			return { type: c.type, id, name: normalizeOrganizationName(c.name).name };
		case 'tag.rename':
		case 'collection.rename':
			keys(c, ['type', 'id', 'name', 'expectedRevision']);
			return {
				type: c.type,
				id,
				expectedRevision: revision(c.expectedRevision),
				name: normalizeOrganizationName(c.name).name
			};
		case 'tag.delete':
		case 'collection.delete':
			keys(c, ['type', 'id', 'expectedRevision']);
			return { type: c.type, id, expectedRevision: revision(c.expectedRevision) };
		case 'tag.add':
		case 'tag.remove':
			keys(c, ['type', 'id', 'tagId']);
			return { type: c.type, id, tagId: uuid(c.tagId) };
		case 'activity.open':
			keys(c, ['type', 'id']);
			return { type: c.type, id };
		case 'saved-search.create':
		case 'saved-search.update':
			keys(c, [
				'type',
				'id',
				'name',
				'filter',
				'sort',
				...(c.type === 'saved-search.update' ? ['expectedRevision'] : [])
			]);
			return {
				type: c.type,
				id,
				name: normalizeOrganizationName(c.name).name,
				filter: parseSearchFilter(c.filter),
				sort: parseSearchSort(c.sort),
				...(c.type === 'saved-search.update'
					? { expectedRevision: revision(c.expectedRevision) }
					: {})
			} as SavedSearchCommand;
		case 'saved-search.delete':
			keys(c, ['type', 'id', 'expectedRevision']);
			return { type: c.type, id, expectedRevision: revision(c.expectedRevision) };
		default:
			throw new ValidationError('Unknown organization command.');
	}
}
export function isInbox(bookmark: Pick<BookmarkProjection, 'collectionId' | 'deletedAt'>): boolean {
	return bookmark.collectionId === null && !bookmark.deletedAt;
}
export function isReadLater(
	bookmark: Pick<BookmarkProjection, 'readingStatus' | 'deletedAt'>
): boolean {
	return !bookmark.deletedAt && bookmark.readingStatus !== 'read';
}
