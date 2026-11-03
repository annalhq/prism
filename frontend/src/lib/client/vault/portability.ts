import type { Command, Revision } from '#lib/domain/contracts.js';
import { serializedBytes } from '#lib/domain/contracts.js';
import { REPLICA_TABLES, type ReplicaTable } from '#lib/domain/replica.js';
import { normalizeOrganizationName } from '#lib/domain/organization.js';
import { normalizeUrl } from '#lib/domain/urls.js';
import { extractReferences, parseReference, validateNoteBody } from '#lib/domain/notes.js';
import { parseMarkdown } from '#lib/domain/markdown.js';
import { parseSearchFilter } from '#lib/domain/search.js';
import { parseCommand, object, uuid } from '#lib/domain/validation.js';
import type { LibraryClient } from './library.js';

type Row = Record<string, unknown>;
type Tables = Record<ReplicaTable, Row[]>;
export type LibraryExport = {
	format: 'prism-v0';
	version: 1;
	exportedAt: string;
	description: string;
	tables: Tables;
	pending: Awaited<ReturnType<LibraryClient['exportPending']>>;
};
export type ImportPreview = {
	valid: boolean;
	counts: Partial<Record<ReplicaTable, number>>;
	warnings: string[];
	errors: string[];
};
export type ImportProgress = {
	accepted: number;
	skipped: number;
	phase: string;
	sourceId?: string;
};
export type ImportResult = {
	status: 'complete' | 'stopped';
	progress: ImportProgress;
	idMap: Record<string, string>;
	skipped: { sourceId: string; reason: string }[];
	blockedNotes: { sourceId: string; bodyMarkdown: string; reason: string }[];
	warnings: string[];
	error?: string;
};
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const live = (row: Row) => !row.deletedAt && !row.purgedAt;
const str = (row: Row, key: string) => {
	if (typeof row[key] !== 'string') throw new Error(`Expected ${key} text.`);
	return row[key] as string;
};
const emptyTables = () =>
	Object.fromEntries(REPLICA_TABLES.map((table) => [table, [] as Row[]])) as Tables;

/** A device metadata package; pending work is separate and is never auto-replayed by import. */
export async function exportLibrary(client: LibraryClient): Promise<LibraryExport> {
	const tables = emptyTables();
	for (const table of REPLICA_TABLES)
		tables[table] = structuredClone(client.listConfirmed<Row>(table));
	if (REPLICA_TABLES.reduce((count, table) => count + tables[table].length, 0) > MAX_RECORDS)
		throw new Error('This device export exceeds the v0 10,000 record limit.');
	const value: LibraryExport = {
		format: 'prism-v0',
		version: 1,
		exportedAt: new Date().toISOString(),
		tables,
		description:
			'Device metadata copy. Not a coherent server backup. Media bytes, note history and credentials are excluded. Pending work and drafts are preserved separately.',
		pending: await client.exportPending()
	};
	if (serializedBytes(value) > MAX_FILE_BYTES)
		throw new Error('This device export exceeds the v0 10 MiB limit.');
	return value;
}
function readPackage(input: unknown): Tables {
	if (typeof input === 'string') {
		if (new TextEncoder().encode(input).byteLength > MAX_FILE_BYTES)
			throw new Error('Import exceeds 10 MiB.');
		input = JSON.parse(input);
	}
	if (serializedBytes(input) > MAX_FILE_BYTES) throw new Error('Import exceeds 10 MiB.');
	const pkg = object(input);
	if (pkg.format !== 'prism-v0' || pkg.version !== 1)
		throw new Error('Expected a prism-v0 version 1 metadata package.');
	const source = object(pkg.tables),
		tables = emptyTables();
	let count = 0;
	for (const table of REPLICA_TABLES) {
		const rows = source[table] ?? [];
		if (!Array.isArray(rows)) throw new Error(`Expected ${table} array.`);
		count += rows.length;
		if (count > MAX_RECORDS) throw new Error('Import exceeds 10,000 records.');
		tables[table] = rows.map(object);
	}
	return tables;
}
function createCommand(
	table: 'bookmarks' | 'people' | 'personas' | 'tags' | 'collections',
	row: Row,
	id: string
): Command {
	const raw =
		table === 'bookmarks'
			? {
					type: 'bookmark.create',
					id,
					kind: row.kind,
					title: row.title,
					description: row.description,
					url: row.url
				}
			: table === 'people'
				? {
						type: 'person.create',
						id,
						displayName: row.displayName,
						bio: row.bio,
						website: row.website
					}
				: table === 'personas'
					? { type: 'persona.create', id, name: row.name, description: row.description }
					: { type: table === 'tags' ? 'tag.create' : 'collection.create', id, name: row.name };
	return parseCommand(raw);
}
export function previewImport(input: unknown): ImportPreview {
	const result: ImportPreview = {
		valid: false,
		counts: {},
		warnings: [
			'Copy import is sequential and can partially succeed. Keep the original file and the resulting progress report.',
			'Media bytes, history, activity, tombstones and pending operations are not restored. Drafts remain in the original package.'
		],
		errors: []
	};
	try {
		const tables = readPackage(input);
		const independentIds = new Set<string>();
		for (const table of ['bookmarks', 'people', 'personas', 'tags', 'collections'] as const)
			for (const row of tables[table]) {
				const id = uuid(row.id);
				if (independentIds.has(id))
					throw new Error('Copy import requires distinct source IDs across entities and taxonomy.');
				independentIds.add(id);
			}
		for (const table of REPLICA_TABLES) {
			result.counts[table] = tables[table].length;
			const ids = new Set<string>();
			for (const row of tables[table]) {
				const key =
					table === 'notes'
						? uuid(row.entityId)
						: table === 'links'
							? uuid(row.sourceId)
							: table === 'activity'
								? uuid(row.bookmarkId)
								: table === 'relationships'
									? `${uuid(row.bookmarkId)}/${uuid(row.personId)}/${str(row, 'role')}`
									: table === 'memberships'
										? `${uuid(row.personaId)}/${uuid(object(row.member).id)}`
										: uuid(row.id);
				if (ids.has(key)) throw new Error(`Duplicate ${table} identity ${key}.`);
				ids.add(key);
				if (
					['bookmarks', 'people', 'personas', 'tags', 'collections'].includes(table) &&
					!row.purgedAt
				) {
					createCommand(
						table as 'bookmarks' | 'people' | 'personas' | 'tags' | 'collections',
						row,
						key
					);
					if (
						'tagIds' in row &&
						(!Array.isArray(row.tagIds) ||
							row.tagIds.length > 50 ||
							row.tagIds.some((id) => !uuid(id)))
					)
						throw new Error('Invalid tags.');
					if (table === 'bookmarks')
						parseCommand({
							type: 'bookmark.organize',
							id: key,
							expectedRevision: '1',
							patch: {
								collectionId: row.collectionId ?? null,
								readingStatus: row.readingStatus,
								isPinned: row.isPinned,
								isArchived: !!row.archivedAt
							}
						});
				}
				if (table === 'notes') validateNoteBody(row.bodyMarkdown);
				if (table === 'savedSearches')
					parseCommand({
						type: 'saved-search.create',
						id: key,
						name: row.name,
						filter: row.filter,
						sort: row.sort
					});
				if (table === 'identities' && live(row))
					parseCommand({
						type: 'person-identity.add',
						id: key,
						personId: row.personId,
						platform: row.platform,
						profileUrl: row.profileUrl,
						nativeAccountId: row.nativeAccountId,
						handle: row.handle,
						confirmed: true
					});
				if (table === 'relationships')
					parseCommand({
						type: 'content-person.add',
						bookmarkId: row.bookmarkId,
						personId: row.personId,
						role: row.role,
						provenance: row.provenance
					});
				if (table === 'memberships')
					parseCommand({
						type: 'persona-member.add',
						personaId: row.personaId,
						member: row.member
					});
				if (table === 'links') {
					if (!Array.isArray(row.edges) || row.edges.length > 400)
						throw new Error('Invalid outgoing links.');
					for (const edge of row.edges) {
						const e = object(edge);
						uuid(e.targetId);
						if (e.kind !== 'note_reference' && e.kind !== 'related')
							throw new Error('Invalid link kind.');
					}
				}
			}
		}
		result.valid = true;
	} catch (error) {
		result.errors.push(error instanceof Error ? error.message : String(error));
	}
	return result;
}

// Rewrites internal destinations to imported IDs. Labels, code, HTML and prose stay byte-for-byte
// intact: each `prism:kind/id` occurrence is replaced on its own and kept only if the parsed
// note is unchanged once its links are remapped, which holds exactly for link and definition
// destinations. Anything else (an escaped or unusual destination) blocks the note instead.
function remapMarkdown(body: string, resolve: (kind: string, id: string) => string): string {
	// Every referenced target must resolve (a missing one blocks the note, as before).
	const table = new Map(
		extractReferences(body).map((ref) => [`${ref.kind}/${ref.id}`, resolve(ref.kind, ref.id)])
	);
	const remap = (href: string) => {
		const ref = parseReference(href);
		const id = ref && table.get(`${ref.kind}/${ref.id}`);
		return ref && id ? `prism:${ref.kind}/${id}` : href;
	};
	const tree = (source: string, map: (href: string) => string) =>
		JSON.stringify(parseMarkdown(source), (key, value) =>
			key === 'href' && typeof value === 'string' ? map(value) : value
		);
	const expected = tree(body, remap);
	const occurrences = [
		...body.matchAll(
			/prism:(bookmark|person|persona)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-z-])/gi
		)
	];
	// Right to left, so earlier offsets stay valid.
	for (const match of occurrences.reverse()) {
		const replacement = remap(match[0]);
		if (replacement === match[0]) continue;
		const next =
			body.slice(0, match.index) + replacement + body.slice(match.index + match[0].length);
		if (tree(next, remap) === expected) body = next;
	}
	// The result must parse exactly as the original with its links remapped.
	if (tree(body, (href) => href) !== expected)
		throw new Error(
			'Escaped internal destination requires manual remapping; original note is retained.'
		);
	return body;
}

/** Explicit copy import. Any uncertain command stops processing; queued intent remains in the client's durable outbox. */
export async function importLibrary(
	client: LibraryClient,
	input: unknown,
	onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
	const preview = previewImport(input);
	const result: ImportResult = {
		status: 'stopped',
		progress: { accepted: 0, skipped: 0, phase: 'validation' },
		idMap: {},
		skipped: [],
		blockedNotes: [],
		warnings: preview.warnings
	};
	const emit = () => onProgress?.({ ...result.progress });
	const skip = (sourceId: string, reason: string) => {
		result.skipped.push({ sourceId, reason });
		result.progress.skipped++;
		emit();
	};
	try {
		if (!preview.valid) throw new Error(preview.errors.join(' '));
		if (
			!client.state.ready ||
			!client.state.online ||
			client.state.pending ||
			client.state.conflicts.length
		)
			throw new Error(
				'Load and sync the library online with no pending work or conflicts before importing.'
			);
		await client.sync();
		if (
			!client.state.online ||
			client.state.error ||
			client.state.pending ||
			client.state.conflicts.length
		)
			throw new Error('Synchronization must finish successfully before importing.');
		const tables = readPackage(input);
		const owned = new Set<string>();
		const kinds = new Map<string, string>();
		for (const table of ['bookmarks', 'people', 'personas'] as const)
			for (const row of tables[table])
				if (live(row))
					kinds.set(
						str(row, 'id'),
						table === 'bookmarks' ? 'bookmark' : table === 'people' ? 'person' : 'persona'
					);
		const send = async (raw: unknown, sourceId: string, phase: string) => {
			if (!client.state.online || client.state.pending || client.state.conflicts.length)
				throw new Error(
					'Import paused because sync is no longer clear. Preserve this report and original package.'
				);
			result.progress.phase = phase;
			result.progress.sourceId = sourceId;
			emit();
			const outcome = await client.save(parseCommand(raw), { waitForSync: true });
			if (outcome.status !== 'accepted')
				throw new Error(
					`${phase}: ${outcome.message ?? outcome.status}. Import stopped; accepted earlier commands remain. Queued intent must be resolved before another import.`
				);
			result.progress.accepted++;
			emit();
		};
		const resolve = (kind: string, id: string) => {
			if (kinds.get(id) !== kind || !result.idMap[id])
				throw new Error(`Missing or purged reference target ${kind}/${id}.`);
			return result.idMap[id];
		};
		const privacyOf = new Map(
			client.list<Row>('tags').map((row) => [str(row, 'id'), row.isPrivate === true])
		);
		for (const table of ['tags', 'collections'] as const) {
			const existing = new Map(
				client
					.list<Row>(table)
					.filter(live)
					.map((row) => [normalizeOrganizationName(row.name).normalizedName, str(row, 'id')])
			);
			for (const row of tables[table])
				if (live(row)) {
					const old = str(row, 'id'),
						name = normalizeOrganizationName(row.name);
					const match = existing.get(name.normalizedName);
					if (match) {
						result.idMap[old] = match;
						skip(old, `Reused active ${table} name.`);
						// An existing tag keeps its own privacy; say so rather than change it silently.
						if (table === 'tags' && row.isPrivate === true && !privacyOf.get(match))
							result.warnings.push(
								`Tag "${name.name}" is private in the import but public here; items imported with it will be public.`
							);
						continue;
					}
					const id = crypto.randomUUID();
					await send(createCommand(table, row, id), old, table);
					result.idMap[old] = id;
					existing.set(name.normalizedName, id);
					if (table === 'tags' && row.isPrivate === true)
						await send(
							{ type: 'tag.privacy', id, expectedRevision: '1' as Revision, isPrivate: true },
							old,
							table
						);
				}
		}
		const urls = new Map(
			client
				.list<Row>('bookmarks')
				.filter(live)
				.filter((row) => typeof row.url === 'string')
				.map((row) => [normalizeUrl(str(row, 'url')).canonicalUrl, str(row, 'id')])
		);
		for (const table of ['bookmarks', 'people', 'personas'] as const)
			for (const row of tables[table]) {
				const old = str(row, 'id');
				if (!live(row)) {
					skip(old, 'Trashed or purged entity omitted from copy import.');
					continue;
				}
				const canonical =
					table === 'bookmarks' && row.url ? normalizeUrl(str(row, 'url')).canonicalUrl : undefined;
				const duplicate = canonical ? urls.get(canonical) : undefined;
				if (duplicate) {
					result.idMap[old] = duplicate;
					skip(
						old,
						'URL already exists; metadata, note and associations were not imported onto that bookmark.'
					);
					continue;
				}
				const id = crypto.randomUUID();
				await send(createCommand(table, row, id), old, table);
				result.idMap[old] = id;
				owned.add(old);
				if (canonical) urls.set(canonical, id);
			}
		const tableFor = (kind: string): ReplicaTable =>
			kind === 'bookmark' ? 'bookmarks' : kind === 'person' ? 'people' : 'personas';
		const revision = (old: string): Revision => {
			const current = client.get<Row>(tableFor(kinds.get(old)!), result.idMap[old]);
			if (!current || typeof current.revision !== 'string')
				throw new Error('Current imported revision is unavailable; synchronize before continuing.');
			return current.revision as Revision;
		};
		for (const table of ['bookmarks', 'people', 'personas'] as const)
			for (const row of tables[table]) {
				const old = str(row, 'id');
				if (!owned.has(old)) continue;
				if (table === 'bookmarks') {
					const collection = row.collectionId ? result.idMap[String(row.collectionId)] : null;
					if (row.collectionId && !collection)
						result.warnings.push(`Bookmark ${old}: missing collection omitted.`);
					await send(
						{
							type: 'bookmark.organize',
							id: result.idMap[old],
							expectedRevision: revision(old),
							patch: {
								collectionId: collection ?? null,
								readingStatus: row.readingStatus,
								isPinned: row.isPinned,
								isArchived: !!row.archivedAt
							}
						},
						old,
						'organization'
					);
				}
				for (const tag of (row.tagIds ?? []) as string[]) {
					if (!result.idMap[tag]) {
						result.warnings.push(`Entity ${old}: missing tag ${tag} omitted.`);
						continue;
					}
					await send(
						{ type: 'tag.add', id: result.idMap[old], tagId: result.idMap[tag] },
						old,
						'tags'
					);
				}
			}
		for (const row of tables.notes) {
			const old = str(row, 'entityId');
			if (!owned.has(old)) {
				skip(old, 'Note belongs to an omitted or existing entity.');
				continue;
			}
			const original = str(row, 'bodyMarkdown');
			let body: string;
			try {
				body = remapMarkdown(original, resolve);
				validateNoteBody(body);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				result.blockedNotes.push({ sourceId: old, bodyMarkdown: original, reason });
				skip(old, `Note blocked: ${reason}`);
				continue;
			}
			await send(
				{ type: 'note.replace', id: result.idMap[old], expectedRevision: '0', bodyMarkdown: body },
				old,
				'notes'
			);
		}
		for (const row of tables.identities)
			if (live(row) && owned.has(str(row, 'personId')))
				await send(
					{
						type: 'person-identity.add',
						id: crypto.randomUUID(),
						personId: result.idMap[str(row, 'personId')],
						platform: row.platform,
						profileUrl: row.profileUrl,
						nativeAccountId: row.nativeAccountId,
						handle: row.handle,
						confirmed: true
					},
					str(row, 'id'),
					'identities'
				);
		for (const row of tables.relationships)
			if (live(row)) {
				const bookmark = str(row, 'bookmarkId'),
					person = str(row, 'personId');
				if (!owned.has(bookmark) || !owned.has(person)) {
					skip(bookmark, 'Role omitted because an endpoint was omitted or already existed.');
					continue;
				}
				await send(
					{
						type: 'content-person.add',
						bookmarkId: result.idMap[bookmark],
						personId: result.idMap[person],
						role: row.role,
						provenance: row.provenance
					},
					bookmark,
					'roles'
				);
			}
		for (const row of tables.memberships)
			if (live(row)) {
				const persona = str(row, 'personaId'),
					member = object(row.member),
					old = str(member, 'id');
				if (!owned.has(persona) || !owned.has(old)) {
					skip(persona, 'Membership omitted because an endpoint was omitted or already existed.');
					continue;
				}
				await send(
					{
						type: 'persona-member.add',
						personaId: result.idMap[persona],
						member: { kind: member.kind, id: result.idMap[old] }
					},
					persona,
					'memberships'
				);
			}
		for (const row of tables.links) {
			const old = str(row, 'sourceId');
			if (!owned.has(old)) continue;
			for (const edge of row.edges as Row[])
				if (edge.kind === 'related') {
					const target = str(edge, 'targetId'),
						kind = kinds.get(target);
					if (!owned.has(target) || !kind) {
						skip(old, 'Related link omitted because its target was omitted or already existed.');
						continue;
					}
					await send(
						{
							type: 'related-link.add',
							id: result.idMap[old],
							expectedRevision: revision(old),
							target: { kind, id: result.idMap[target] }
						},
						old,
						'links'
					);
				}
		}
		for (const row of tables.savedSearches)
			if (live(row)) {
				const old = str(row, 'id'),
					filter = parseSearchFilter(row.filter);
				try {
					filter.tags = filter.tags.map((r) => {
						if (!result.idMap[r.id]) throw new Error(`Missing tag ${r.id}`);
						return { ...r, id: result.idMap[r.id] };
					});
					if (filter.collection) {
						if (!result.idMap[filter.collection.id]) throw new Error('Missing collection');
						filter.collection = { ...filter.collection, id: result.idMap[filter.collection.id] };
					}
					filter.people = filter.people.map((r) => ({ ...r, id: resolve('person', r.id) }));
					filter.personas = filter.personas.map((r) => ({ ...r, id: resolve('persona', r.id) }));
				} catch (error) {
					skip(old, `Saved filter blocked: ${String(error)}`);
					continue;
				}
				await send(
					{
						type: 'saved-search.create',
						id: crypto.randomUUID(),
						name: row.name,
						filter,
						sort: row.sort
					},
					old,
					'saved searches'
				);
			}
		result.status = 'complete';
		result.progress.phase = 'complete';
		emit();
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
		result.progress.phase = 'stopped';
		emit();
	}
	return result;
}
