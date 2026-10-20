import {
	normalizeSearchText,
	inspectSearchReferences,
	type SearchFilter
} from '#lib/domain/search.js';
import type { ReplicaTable } from '#lib/domain/replica.js';
import type { EntityRef } from '#lib/domain/entities.js';

type Row = Record<string, unknown>;
export type LibraryReader = {
	list<T>(table: ReplicaTable): T[];
	get<T>(table: ReplicaTable, key: string): T | undefined;
};
const id = (row: Row) => String(row.id ?? row.entityId ?? '');
const label = (row: Row) => String(row.title ?? row.displayName ?? row.name ?? 'Untitled');
export function emptySearch(): SearchFilter {
	return {
		version: 1,
		scope: 'active',
		text: [],
		tags: [],
		kinds: [],
		people: [],
		personas: [],
		statuses: [],
		has: []
	};
}
export function parseLibraryQuery(
	input: string,
	library: LibraryReader
): { filter: SearchFilter; error?: string } {
	const filter = emptySearch();
	const tokens: { text: string; quoted: boolean }[] = [];
	let value = '',
		quoted = false,
		inQuote = false;
	for (const char of input.trim()) {
		if (char === '"') {
			inQuote = !inQuote;
			quoted = true;
		} else if (/\s/.test(char) && !inQuote) {
			if (value) tokens.push({ text: value, quoted });
			value = '';
			quoted = false;
		} else value += char;
	}
	if (inQuote) return { filter, error: 'Close the quotation mark to search.' };
	if (value) tokens.push({ text: value, quoted });
	const resolve = (table: ReplicaTable, name: string) => {
		const matches = library
			.list<Row>(table)
			.filter(
				(row) =>
					!row.deletedAt &&
					!row.purgedAt &&
					(id(row) === name || normalizeSearchText(label(row)) === normalizeSearchText(name))
			);
		if (matches.length !== 1)
			throw new Error(
				matches.length
					? `Several entries are named “${name}”. Use its ID to choose one.`
					: `“${name}” was not found.`
			);
		return { id: id(matches[0]), label: label(matches[0]) };
	};
	try {
		for (const token of tokens) {
			const t = token.text;
			if (t.startsWith('#')) filter.tags.push(resolve('tags', t.slice(1)));
			else if (t.startsWith('@')) {
				if (filter.collection) throw new Error('Use one collection per search.');
				filter.collection = resolve('collections', t.slice(1));
			} else if (t.startsWith('person:')) {
				const [, ...name] = t.split(':');
				filter.people.push({
					...resolve('people', name.join(':')),
					role: 'any'
				});
			} else if (t.startsWith('site:')) {
				const host = t.slice(5).toLowerCase();
				if (!host || /[\s/@?#:]/.test(host)) throw new Error('Use a hostname after site:.');
				filter.site = host;
			} else if (t.startsWith('is:')) {
				const v = t.slice(3);
				if (['page', 'social', 'image', 'person'].includes(v))
					filter.kinds.push(v as SearchFilter['kinds'][number]);
				else if (v === 'trash') {
					filter.scope = 'trash';
				} else throw new Error(`Unknown filter “${t}”.`);
			} else if (t.startsWith('has:')) {
				const v = t.slice(4);
				if (!['note', 'media', 'backlinks'].includes(v)) throw new Error(`Unknown filter “${t}”.`);
				filter.has.push(v as SearchFilter['has'][number]);
			} else if (t.includes(':')) throw new Error(`Unknown filter “${t}”.`);
			else filter.text.push({ value: t, phrase: token.quoted });
		}
		return { filter };
	} catch (error) {
		return { filter, error: (error as Error).message };
	}
}
export function searchLibrary(
	library: LibraryReader,
	view: string,
	input: string,
	sort = 'newest'
): { items: (Row & { entityKind: EntityRef['kind'] })[]; error?: string; filter: SearchFilter } {
	const parsed = parseLibraryQuery(input, library);
	let filter = parsed.filter;
	if (view.startsWith('saved:')) {
		const saved = library.get<Row>('savedSearches', view.slice(6));
		if (!saved || saved.deletedAt)
			return { items: [], filter, error: 'This saved search is unavailable.' };
		filter = saved.filter as SearchFilter;
		const checked = inspectSearchReferences(filter, (target) => {
			const table = (
				{ tag: 'tags', collection: 'collections', person: 'people', persona: 'personas' } as const
			)[target.kind];
			const row = library.get<Row>(table, target.id);
			return !!row && !row.deletedAt && !row.purgedAt;
		});
		if (!checked.valid)
			return {
				items: [],
				filter,
				error:
					'Needs attention: a saved filter refers to deleted content. Edit or remove this saved search.'
			};
		sort = String(saved.sort);
	}
	if (parsed.error) return { ...parsed, items: [] };
	if (view === 'trash') filter = { ...filter, scope: 'trash' };
	const notes = new Map(
		library.list<Row>('notes').map((row) => [String(row.entityId), String(row.bodyMarkdown)])
	);
	const tags = new Map(library.list<Row>('tags').map((row) => [id(row), label(row)]));
	const roles = library.list<Row>('relationships').filter((row) => !row.deletedAt);
	const memberships = library.list<Row>('memberships').filter((row) => !row.deletedAt);
	const links = library.list<Row>('links');
	const active = (kind: string, targetId: string) => {
		const row = library.get<Row>(kind === 'person' ? 'people' : 'bookmarks', targetId);
		return !!row && !row.deletedAt && !row.purgedAt;
	};
	const all: (Row & { entityKind: EntityRef['kind'] })[] = [
		...library.list<Row>('bookmarks').map((row) => ({ ...row, entityKind: 'bookmark' as const })),
		...library.list<Row>('people').map((row) => ({ ...row, entityKind: 'person' as const })),
		...library.list<Row>('personas').map((row) => ({ ...row, entityKind: 'persona' as const }))
	];
	const items = all.filter((row) => {
		if (row.purgedAt || row.entityKind === 'persona') return false;
		if (filter.scope === 'trash' ? !row.deletedAt : !!row.deletedAt) return false;
		if (view === 'people' && row.entityKind !== 'person') return false;
		if (view !== 'people' && row.entityKind !== 'bookmark') return false;
		if (
			!['people', 'personas', 'trash'].includes(view) &&
			!input.trim() &&
			!view.startsWith('saved:') &&
			row.entityKind !== 'bookmark'
		)
			return false;
		if (view === 'inbox' && (row.entityKind !== 'bookmark' || row.collectionId)) return false;
		if (view === 'later' && (row.entityKind !== 'bookmark' || row.readingStatus !== 'reading'))
			return false;
		const tagIds = (row.tagIds as string[]) ?? [];
		if (view.startsWith('tag:') && !tagIds.includes(view.slice(4))) return false;
		if (view.startsWith('collection:') && row.collectionId !== view.slice(11)) return false;
		if (!filter.tags.every((tag) => tagIds.includes(tag.id))) return false;
		if (filter.collection === null && row.collectionId) return false;
		if (filter.collection && row.collectionId !== filter.collection.id) return false;
		if (
			filter.kinds.length &&
			!filter.kinds.includes(row.entityKind === 'bookmark' ? (row.kind as 'page') : row.entityKind)
		)
			return false;
		if (filter.statuses.length && !filter.statuses.includes(row.readingStatus as 'read'))
			return false;
		if (
			filter.site &&
			!(row.domain === filter.site || String(row.domain ?? '').endsWith(`.${filter.site}`))
		)
			return false;
		if (
			!filter.people.every(
				(person) =>
					active('person', person.id) &&
					roles.some((r) => r.bookmarkId === row.id && r.personId === person.id)
			)
		)
			return false;
		if (
			!filter.personas.every((persona) =>
				memberships.some(
					(m) => m.personaId === persona.id && (m.member as EntityRef)?.id === row.id
				)
			)
		)
			return false;
		const body = notes.get(String(row.id)) ?? '';
		if (filter.has.includes('note') && !body.trim()) return false;
		if (filter.has.includes('media')) return false; // Attachments are a later provider slice.
		if (
			filter.has.includes('backlinks') &&
			!links.some(
				(link) =>
					link.sourceId !== row.id &&
					((link.edges as Row[]) ?? []).some((edge) => edge.targetId === row.id) &&
					!!all.find(
						(source) => source.id === link.sourceId && !source.deletedAt && !source.purgedAt
					)
			)
		)
			return false;
		const fields = [
			label(row),
			row.url,
			row.description,
			row.bio,
			body,
			...tagIds.map((tag) => tags.get(tag))
		].map((value) => normalizeSearchText(String(value ?? '')));
		return filter.text.every((term) =>
			fields.some((field) => field.includes(normalizeSearchText(term.value)))
		);
	});
	const activity = new Map(
		library.list<Row>('activity').map((row) => [String(row.bookmarkId), String(row.lastOpenedAt)])
	);
	items.sort(
		(a, b) =>
			(sort === 'title'
				? normalizeSearchText(label(a)).localeCompare(normalizeSearchText(label(b)))
				: sort === 'recently_opened'
					? (activity.get(String(b.id)) ?? '').localeCompare(activity.get(String(a.id)) ?? '')
					: String(b.createdAt).localeCompare(String(a.createdAt))) ||
			String(a.id).localeCompare(String(b.id))
	);
	return { items, filter };
}
export const entityLabel = label;
