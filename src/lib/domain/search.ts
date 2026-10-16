import { caseFold } from 'unicode-case-folding';
import type { BookmarkKind } from './contracts.js';
import { keys, object, text, uuid, ValidationError } from './validation-fields.js';

export const SEARCH_AST_VERSION = 1 as const;
export const MAX_SEARCH_FILTER_BYTES = 16_384;
export const SEARCH_SORTS = ['newest', 'title', 'recently_opened'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export type SearchReference = { id: string; label: string };
export type SearchFilter = {
	version: 1;
	scope: 'active' | 'archived' | 'trash';
	text: { value: string; phrase: boolean }[];
	tags: SearchReference[];
	// Omitted = any collection; null = Inbox; an ID = that collection.
	collection?: SearchReference | null;
	kinds: (BookmarkKind | 'person' | 'persona')[];
	people: (SearchReference & { role: 'any' | 'author' })[];
	personas: SearchReference[];
	statuses: ('unread' | 'reading' | 'read')[];
	has: ('note' | 'media' | 'backlinks')[];
	pinned: boolean;
	site?: string;
};
export type SearchTarget = SearchReference & { kind: 'tag' | 'collection' | 'person' | 'persona' };

export function normalizeSearchText(value: string): string {
	return caseFold(value.normalize('NFC')).normalize('NFC').replace(/\s+/gu, ' ').trim();
}
export function parseSearchSort(value: unknown): SearchSort {
	if (!SEARCH_SORTS.includes(value as SearchSort))
		throw new ValidationError('Unknown search sort.');
	return value as SearchSort;
}
function list(value: unknown): unknown[] {
	if (!Array.isArray(value) || value.length > 64)
		throw new ValidationError('Expected at most 64 search values.');
	return value;
}
function reference(value: unknown, labelLimit: number): SearchReference {
	const r = object(value);
	keys(r, ['id', 'label']);
	return { id: uuid(r.id), label: text(r.label, labelLimit, true) };
}
function enumList<T extends string>(value: unknown, allowed: readonly T[]): T[] {
	return [
		...new Set(
			list(value).map((item) => {
				if (!allowed.includes(item as T)) throw new ValidationError('Unknown search filter value.');
				return item as T;
			})
		)
	].sort();
}
function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new ValidationError('Expected a boolean.');
	return value;
}
function uniqueReferences<T extends SearchReference>(values: T[], key: (value: T) => string): T[] {
	if (new Set(values.map(key)).size !== values.length)
		throw new ValidationError('Duplicate search reference.');
	return values;
}
export function parseSearchFilter(value: unknown): SearchFilter {
	const f = object(value);
	keys(f, [
		'version',
		'scope',
		'text',
		'tags',
		'collection',
		'kinds',
		'people',
		'personas',
		'statuses',
		'has',
		'pinned',
		'site'
	]);
	if (f.version !== SEARCH_AST_VERSION)
		throw new ValidationError('Unsupported saved-search AST version.');
	if (f.scope !== 'active' && f.scope !== 'archived' && f.scope !== 'trash')
		throw new ValidationError('Unknown search scope.');
	const filter: SearchFilter = {
		version: SEARCH_AST_VERSION,
		scope: f.scope,
		text: list(f.text).map((value) => {
			const term = object(value);
			keys(term, ['value', 'phrase']);
			return { value: text(term.value, 500, true), phrase: bool(term.phrase) };
		}),
		tags: uniqueReferences(
			list(f.tags).map((r) => reference(r, 64)),
			(r) => r.id
		),
		...('collection' in f
			? { collection: f.collection === null ? null : reference(f.collection, 64) }
			: {}),
		kinds: enumList(f.kinds, ['page', 'social', 'image', 'person', 'persona'] as const),
		people: uniqueReferences(
			list(f.people).map((value) => {
				const r = object(value);
				keys(r, ['id', 'label', 'role']);
				if (r.role !== 'any' && r.role !== 'author')
					throw new ValidationError('Unknown person filter role.');
				return { ...reference({ id: r.id, label: r.label }, 200), role: r.role };
			}),
			(r) => `${r.role}/${r.id}`
		),
		personas: uniqueReferences(
			list(f.personas).map((r) => reference(r, 64)),
			(r) => r.id
		),
		statuses: enumList(f.statuses, ['unread', 'reading', 'read'] as const),
		has: enumList(f.has, ['note', 'media', 'backlinks'] as const),
		pinned: bool(f.pinned)
	};
	if ('site' in f) {
		const input = text(f.site, 253, true);
		let parsed: URL;
		try {
			parsed = new URL(`https://${input}`);
		} catch {
			throw new ValidationError('Expected a site hostname.');
		}
		if (
			parsed.username ||
			parsed.password ||
			parsed.port ||
			parsed.pathname !== '/' ||
			parsed.search ||
			parsed.hash ||
			/[\s/@?#:]/u.test(input) ||
			!parsed.hostname
		)
			throw new ValidationError('Expected a site hostname without a path, port or credentials.');
		filter.site = parsed.hostname;
	}
	const terms =
		filter.text.length +
		filter.tags.length +
		filter.people.length +
		filter.personas.length +
		filter.kinds.length +
		filter.statuses.length +
		filter.has.length +
		Number(filter.collection !== undefined) +
		Number(filter.site !== undefined) +
		Number(filter.pinned);
	if (
		terms > 64 ||
		new TextEncoder().encode(JSON.stringify(filter)).byteLength > MAX_SEARCH_FILTER_BYTES
	)
		throw new ValidationError('Saved-search filter exceeds its 64-term or 16 KiB limit.');
	return filter;
}
export function searchTargets(filter: SearchFilter): SearchTarget[] {
	return [
		...filter.tags.map((r) => ({ ...r, kind: 'tag' as const })),
		...(filter.collection ? [{ ...filter.collection, kind: 'collection' as const }] : []),
		...filter.people.map((r) => ({ id: r.id, label: r.label, kind: 'person' as const })),
		...filter.personas.map((r) => ({ ...r, kind: 'persona' as const }))
	];
}
// Use the current replica/catalog, never snapshot labels, to resolve saved identities.
// An invalid view must show Needs attention rather than run a weakened filter.
export function inspectSearchReferences(
	filter: SearchFilter,
	isAvailable: (target: SearchTarget) => boolean
) {
	const missing = searchTargets(filter).filter((target) => !isAvailable(target));
	return { valid: missing.length === 0, missing };
}

// The search worker consumes profiles and role rows separately; mentions/tags never
// synthesize authorship. Imports and replica bootstrap must preserve these IDs.
export type PersonSearchDocument = Pick<
	import('./people.js').PersonProjection,
	| 'id'
	| 'kind'
	| 'displayName'
	| 'bio'
	| 'website'
	| 'tagIds'
	| 'deletedAt'
	| 'purgedAt'
	| 'lastSeq'
> & { noteText: string; tagNames: string[] };
export type PersonSearchRelationship = Pick<
	import('./relationships.js').ContentPersonProjection,
	'bookmarkId' | 'personId' | 'role' | 'deletedAt' | 'lastSeq'
>;
export function personSearchFields(person: PersonSearchDocument): string[] {
	return [
		person.displayName,
		person.bio,
		person.website ?? '',
		person.noteText,
		...person.tagNames
	].map(normalizeSearchText);
}
