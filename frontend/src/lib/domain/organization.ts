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
	| { type: 'tag.delete' | 'collection.delete'; id: string; expectedRevision: Revision }
	| { type: 'tag.move'; id: string; expectedRevision: Revision; position: string }
	| { type: 'tag.privacy'; id: string; expectedRevision: Revision; isPrivate: boolean };
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
	'tag.move',
	'tag.privacy',
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
// Tag order uses fractional keys: base-36 digits read as a fraction after the point, so a
// key fits between any two others without renumbering. Trailing zeros would make two
// spellings of one value, so they are not allowed.
const POSITION_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
export const TAG_POSITION_PATTERN = /^[0-9a-z]{0,127}[1-9a-z]$/;
export function parseTagPosition(value: unknown): string {
	if (typeof value !== 'string' || !TAG_POSITION_PATTERN.test(value))
		throw new ValidationError('Invalid tag position.');
	return value;
}
/** A key strictly between `a` and `b`; null means the start or the end of the list. */
export function positionBetween(a: string | null, b: string | null): string {
	if (a !== null && b !== null && a >= b) throw new Error('Positions must be ascending.');
	return midpoint(a ?? '', b);
}
function midpoint(a: string, b: string | null): string {
	if (b !== null) {
		let n = 0;
		while ((a[n] ?? '0') === b[n]) n++;
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
	}
	const low = a ? POSITION_DIGITS.indexOf(a[0]) : 0;
	const high = b !== null ? POSITION_DIGITS.indexOf(b[0]) : POSITION_DIGITS.length;
	if (high - low > 1) return POSITION_DIGITS[Math.round((low + high) / 2)];
	if (b !== null && b.length > 1) return b[0];
	return POSITION_DIGITS[low] + midpoint(a.slice(1), null);
}
/** `count` evenly spaced ascending keys, for giving a whole list its first order. */
export function spreadPositions(count: number): string[] {
	let width = 1;
	while (36 ** width <= count) width++;
	const step = 36 ** width / (count + 1);
	return Array.from({ length: count }, (_, index) =>
		Math.floor(step * (index + 1))
			.toString(36)
			.padStart(width, '0')
			.replace(/0+$/, '')
	);
}
/** Ordered tags first by key, then the never-ordered ones in their existing order. */
export function sortByPosition<T extends { position?: unknown }>(rows: T[]): T[] {
	const key = (row: T) => (typeof row.position === 'string' ? row.position : null);
	return rows
		.map((row, index) => ({ row, index }))
		.sort((x, y) => {
			const a = key(x.row),
				b = key(y.row);
			if (a !== null && b !== null) return a < b ? -1 : a > b ? 1 : x.index - y.index;
			if (a !== null) return -1;
			if (b !== null) return 1;
			return x.index - y.index;
		})
		.map(({ row }) => row);
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
		case 'tag.move':
			keys(c, ['type', 'id', 'expectedRevision', 'position']);
			return {
				type: c.type,
				id,
				expectedRevision: revision(c.expectedRevision),
				position: parseTagPosition(c.position)
			};
		case 'tag.privacy':
			keys(c, ['type', 'id', 'expectedRevision', 'isPrivate']);
			if (typeof c.isPrivate !== 'boolean')
				throw new ValidationError('Tag privacy must be true or false.');
			return {
				type: c.type,
				id,
				expectedRevision: revision(c.expectedRevision),
				isPrivate: c.isPrivate
			};
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
