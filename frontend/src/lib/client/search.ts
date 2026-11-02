import {
	normalizeSearchText,
	inspectSearchReferences,
	type SearchFilter
} from '#lib/domain/search.js';
import type { ReplicaTable } from '#lib/domain/replica.js';
import type { EntityRef } from '#lib/domain/entities.js';
import { tweetStatusId } from '#lib/domain/tweets.js';
import { parseToken, tokenizeQuery } from './search-query.js';

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
type Entry = Row & { entityKind: EntityRef['kind'] };
/** What a clause can look at, built once per search. */
type SearchContext = {
	notes: Map<string, string>;
	tagNames: Map<string, string>;
	roles: Row[];
	links: Row[];
	memberships: Row[];
	isLive: (id: string) => boolean;
	activePerson: (id: string) => boolean;
};
/** One condition. A search is every clause, each one optionally negated. */
type Clause = { negate: boolean; test: (row: Entry, context: SearchContext) => boolean };
export type ParsedQuery = {
	filter: SearchFilter;
	clauses: Clause[];
	error?: string;
};

const DAY = 86_400_000;
/** `2026-01-31`, `2026-01`, or a span back from now: `7d`, `2w`, `3m`, `1y`. */
export function parseSearchDate(value: string, now = Date.now()): number {
	const span = /^(\d{1,4})([dwmy])$/i.exec(value);
	if (span) {
		const unit = { d: 1, w: 7, m: 30, y: 365 }[span[2].toLowerCase() as 'd' | 'w' | 'm' | 'y'];
		return now - unit * Number(span[1]) * DAY;
	}
	if (/^\d{4}-\d{2}(-\d{2})?$/.test(value)) {
		const time = Date.parse(value.length === 7 ? `${value}-01` : value);
		if (Number.isFinite(time)) return time;
	}
	throw new Error(`Use a date like 2026-01-31 or a span like 7d, not “${value}”.`);
}
const tagIdsOf = (row: Row) => (row.tagIds as string[]) ?? [];
const connected = (row: Row, personId: string, context: SearchContext) =>
	row.id === personId ||
	context.roles.some((r) => r.bookmarkId === row.id && r.personId === personId) ||
	context.links.some(
		(link) =>
			link.sourceId === row.id &&
			((link.edges as Row[]) ?? []).some((edge) => edge.targetId === personId)
	);
const hasBacklinks = (row: Row, context: SearchContext) =>
	context.links.some(
		(link) =>
			link.sourceId !== row.id &&
			((link.edges as Row[]) ?? []).some((edge) => edge.targetId === row.id) &&
			context.isLive(String(link.sourceId))
	);
const textFields = (row: Row, context: SearchContext) =>
	[
		label(row),
		row.url,
		row.description,
		row.bio,
		context.notes.get(String(row.id)) ?? '',
		...tagIdsOf(row).map((tag) => context.tagNames.get(tag))
	].map((value) => normalizeSearchText(String(value ?? '')));

export function parseLibraryQuery(input: string, library: LibraryReader): ParsedQuery {
	const filter = emptySearch();
	const clauses: Clause[] = [];
	const { tokens, error } = tokenizeQuery(input.trim());
	if (error) return { filter, clauses, error };
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
	// `@name` is a person bang: an exact handle or name wins, otherwise a unique prefix
	// of either, so results narrow while the handle is still being typed.
	const resolvePerson = (name: string) => {
		const needle = normalizeSearchText(name.replace(/^@/, ''));
		if (!needle) throw new Error('Type a username or name after @.');
		const people = library.list<Row>('people').filter((row) => !row.deletedAt && !row.purgedAt);
		const live = new Set(people.map(id));
		const handles = library
			.list<Row>('identities')
			.filter((row) => !row.deletedAt && row.handle && live.has(String(row.personId)))
			.map((row) => ({
				personId: String(row.personId),
				handle: normalizeSearchText(String(row.handle))
			}));
		const compact = (row: Row) => normalizeSearchText(label(row)).replace(/\s+/g, '');
		const pick = (ids: Set<string>) =>
			ids.size === 1 ? people.find((row) => id(row) === [...ids][0]) : undefined;
		const exact = new Set([
			...handles.filter((h) => h.handle === needle).map((h) => h.personId),
			...people
				.filter((row) => normalizeSearchText(label(row)) === needle || compact(row) === needle)
				.map(id)
		]);
		// Handles are what people type after @, so a handle prefix outranks a name prefix.
		const handlePrefix = new Set(
			handles.filter((h) => h.handle.startsWith(needle)).map((h) => h.personId)
		);
		const namePrefix = new Set(
			people
				.filter(
					(row) =>
						compact(row).startsWith(needle.replace(/\s+/g, '')) ||
						normalizeSearchText(label(row))
							.split(' ')
							.some((word) => word.startsWith(needle))
				)
				.map(id)
		);
		const tiers = [exact, handlePrefix, namePrefix];
		const tier = tiers.find((ids) => ids.size > 0);
		const found = tier && pick(tier);
		if (!found)
			throw new Error(
				tier
					? `Several people match “@${name}”. Keep typing to choose one.`
					: `No person matches “@${name}”.`
			);
		return { id: id(found), label: label(found) };
	};
	const tagExists = (name: string) =>
		library
			.list<Row>('tags')
			.some(
				(row) => !row.deletedAt && normalizeSearchText(label(row)) === normalizeSearchText(name)
			);
	const text = (value: string, negate: boolean, onlyTitle = false) => {
		const needle = normalizeSearchText(value);
		if (!needle) return;
		clauses.push({
			negate,
			test: (row, context) =>
				onlyTitle
					? normalizeSearchText(label(row)).includes(needle)
					: textFields(row, context).some((field) => field.includes(needle))
		});
		if (!negate && !onlyTitle) filter.text.push({ value, phrase: false });
	};
	const tags = (names: string[], negate: boolean) => {
		if (!names.length) throw new Error('Name a tag after #.');
		const found = names.map((name) => resolve('tags', name));
		if (!negate && found.length === 1) filter.tags.push(found[0]);
		// One clause per group: `#a|b` is a union; separate `#a #b` tokens intersect.
		const set = new Set(found.map((tag) => tag.id));
		clauses.push({ negate, test: (row) => tagIdsOf(row).some((tag) => set.has(tag)) });
	};
	try {
		for (const token of tokens.map((t) => parseToken(t.raw))) {
			const { negate, values } = token;
			if (token.kind === 'text') text(values[0], negate);
			else if (token.kind === 'bare') {
				if (tagExists(values[0])) tags(values, true);
				else text(values[0], true);
			} else if (token.kind === 'tag') tags(values, negate);
			else if (token.kind === 'person') {
				if (!values.length) throw new Error('Type a username or name after @.');
				const found = values.map(resolvePerson);
				if (!negate && found.length === 1 && !filter.people.some((p) => p.id === found[0].id))
					filter.people.push({ ...found[0], role: 'any' });
				clauses.push({
					negate,
					test: (row, context) =>
						found.some(
							(person) => context.activePerson(person.id) && connected(row, person.id, context)
						)
				});
			} else {
				const key = token.key!;
				if (!values.length) throw new Error(`Add a value after ${key}:.`);
				if (key === 'site') {
					const hosts = values.map((host) => host.toLowerCase().replace(/^www\./, ''));
					if (hosts.some((host) => /[\s/@?#:]/.test(host)))
						throw new Error('Use a hostname after site:, like site:example.com.');
					if (!negate && hosts.length === 1) filter.site = hosts[0];
					clauses.push({
						negate,
						test: (row) => {
							const domain = String(row.domain ?? '').replace(/^www\./, '');
							return hosts.some((host) => domain === host || domain.endsWith(`.${host}`));
						}
					});
				} else if (key === 'title') text(values.join(' '), negate, true);
				else if (key === 'before' || key === 'after') {
					const edge = parseSearchDate(values[0]);
					clauses.push({
						negate,
						test: (row) => {
							const at = Date.parse(String(row.createdAt));
							return key === 'before' ? at < edge : at >= edge;
						}
					});
				} else if (key === 'is') {
					if (values.includes('trash')) {
						if (negate || values.length > 1) throw new Error('Use is:trash on its own.');
						filter.scope = 'trash';
						continue;
					}
					const tests = values.map((value): Clause['test'] => {
						if (['page', 'social', 'image', 'text', 'stash', 'person'].includes(value)) {
							if (!negate) filter.kinds.push(value as SearchFilter['kinds'][number]);
							return (row) => (row.entityKind === 'bookmark' ? row.kind : row.entityKind) === value;
						}
						if (value === 'tweet') return (row) => !!tweetStatusId(row.url);
						if (value === 'later') return (row) => row.readingStatus === 'reading';
						if (value === 'untagged') return (row) => !tagIdsOf(row).length;
						throw new Error(
							`Unknown filter “is:${value}”. Try page, social, tweet, later, untagged or trash.`
						);
					});
					clauses.push({ negate, test: (row, context) => tests.some((t) => t(row, context)) });
				} else if (key === 'has') {
					const tests = values.map((value): Clause['test'] => {
						if (value === 'note')
							return (row, context) => !!context.notes.get(String(row.id))?.trim();
						if (value === 'tags' || value === 'tag') return (row) => tagIdsOf(row).length > 0;
						if (value === 'people' || value === 'person')
							return (row, context) =>
								context.roles.some(
									(r) => r.bookmarkId === row.id && context.activePerson(String(r.personId))
								);
						if (value === 'backlinks') return hasBacklinks;
						if (value === 'media') return () => false; // Attachments are a later provider slice.
						throw new Error(`Unknown filter “has:${value}”. Try note, tags, people or backlinks.`);
					});
					if (!negate)
						for (const value of values)
							if (['note', 'media', 'backlinks'].includes(value))
								filter.has.push(value as SearchFilter['has'][number]);
					clauses.push({ negate, test: (row, context) => tests.some((t) => t(row, context)) });
				} else if (key === 'collection' && !negate) {
					const collection = resolve('collections', values.join(':'));
					filter.collection = collection;
					clauses.push({ negate, test: (row) => row.collectionId === collection.id });
				} else
					throw new Error(
						`Unknown filter “${key}:”. Try site:, is:, has:, before:, after: or title:.`
					);
			}
		}
		return { filter, clauses };
	} catch (error) {
		return { filter, clauses: [], error: (error as Error).message };
	}
}
/** A saved search's stored filter, as the same clauses a typed query produces. */
function filterClauses(filter: SearchFilter): Clause[] {
	const clauses: Clause[] = [];
	const add = (test: Clause['test']) => clauses.push({ negate: false, test });
	for (const tag of filter.tags) add((row) => tagIdsOf(row).includes(tag.id));
	if (filter.collection === null) add((row) => !row.collectionId);
	else if (filter.collection) {
		const target = filter.collection.id;
		add((row) => row.collectionId === target);
	}
	if (filter.kinds.length)
		add((row) =>
			filter.kinds.includes(row.entityKind === 'bookmark' ? (row.kind as 'page') : row.entityKind)
		);
	if (filter.statuses.length) add((row) => filter.statuses.includes(row.readingStatus as 'read'));
	if (filter.site) {
		const host = filter.site;
		add((row) => row.domain === host || String(row.domain ?? '').endsWith(`.${host}`));
	}
	for (const person of filter.people)
		add((row, context) => context.activePerson(person.id) && connected(row, person.id, context));
	for (const persona of filter.personas)
		add((row, context) =>
			context.memberships.some(
				(m) => m.personaId === persona.id && (m.member as EntityRef)?.id === row.id
			)
		);
	if (filter.has.includes('note'))
		add((row, context) => !!context.notes.get(String(row.id))?.trim());
	if (filter.has.includes('media')) add(() => false);
	if (filter.has.includes('backlinks')) add(hasBacklinks);
	for (const term of filter.text) {
		const needle = normalizeSearchText(term.value);
		add((row, context) => textFields(row, context).some((field) => field.includes(needle)));
	}
	return clauses;
}
export function searchLibrary(
	library: LibraryReader,
	view: string,
	input: string,
	sort = 'newest'
): { items: Entry[]; error?: string; filter: SearchFilter } {
	const parsed = parseLibraryQuery(input, library);
	let filter = parsed.filter;
	let clauses = parsed.clauses;
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
		clauses = filterClauses(filter);
		sort = String(saved.sort);
	}
	if (parsed.error) return { filter: parsed.filter, error: parsed.error, items: [] };
	if (view === 'trash') filter = { ...filter, scope: 'trash' };
	const all: Entry[] = [
		...library.list<Row>('bookmarks').map((row) => ({ ...row, entityKind: 'bookmark' as const })),
		...library.list<Row>('people').map((row) => ({ ...row, entityKind: 'person' as const })),
		...library.list<Row>('personas').map((row) => ({ ...row, entityKind: 'persona' as const }))
	];
	const liveIds = new Set(all.filter((row) => !row.deletedAt && !row.purgedAt).map(id));
	const context: SearchContext = {
		notes: new Map(
			library.list<Row>('notes').map((row) => [String(row.entityId), String(row.bodyMarkdown)])
		),
		tagNames: new Map(library.list<Row>('tags').map((row) => [id(row), label(row)])),
		roles: library.list<Row>('relationships').filter((row) => !row.deletedAt),
		links: library.list<Row>('links'),
		memberships: library.list<Row>('memberships').filter((row) => !row.deletedAt),
		isLive: (target) => liveIds.has(target),
		activePerson: (target) => {
			const row = library.get<Row>('people', target);
			return !!row && !row.deletedAt && !row.purgedAt;
		}
	};
	const items = all.filter((row) => {
		if (row.purgedAt || row.entityKind === 'persona') return false;
		if (filter.scope === 'trash' ? !row.deletedAt : !!row.deletedAt) return false;
		if (view === 'people' && row.entityKind !== 'person') return false;
		if (view !== 'people' && row.entityKind !== 'bookmark') return false;
		if (view === 'inbox' && (row.entityKind !== 'bookmark' || row.collectionId)) return false;
		if (view === 'later' && (row.entityKind !== 'bookmark' || row.readingStatus !== 'reading'))
			return false;
		if (view.startsWith('tag:') && !tagIdsOf(row).includes(view.slice(4))) return false;
		if (view.startsWith('collection:') && row.collectionId !== view.slice(11)) return false;
		return clauses.every((clause) => clause.test(row, context) !== clause.negate);
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
