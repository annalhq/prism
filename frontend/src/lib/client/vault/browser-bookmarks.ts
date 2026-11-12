// Browser bookmark files (Netscape HTML) in and out of Prism.
//
// Import is planned in full before anything is written: the preview shows every folder → collection
// / tag mapping, skipped link and shortened name. Writes then go through the ordinary command path
// in bounded bulk chunks. Bookmark, taxonomy and operation IDs derive from a per-file session seed,
// so a stopped, cancelled or reloaded import resumes without duplicating accepted work, and the
// server's receipts answer any chunk that is sent twice.
import {
	MAX_BULK_BOOKMARKS,
	serializedBytes,
	type BulkBookmarkCommand,
	type Command,
	type Revision
} from '#lib/domain/contracts.js';
import { MAX_ENTITY_TAGS, normalizeOrganizationName } from '#lib/domain/organization.js';
import { normalizeUrl } from '#lib/domain/urls.js';
import { parseCommand } from '#lib/domain/validation.js';
import {
	parseNetscape,
	serializeNetscape,
	type NetscapeExportFolder,
	type NetscapeExportLink
} from '#lib/domain/netscape.js';
import { inferBookmarkKind } from '../workflows.js';
import type { LibraryClient, SaveOutcome } from './library.js';

type Row = Record<string, unknown>;
export const BROWSER_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const TITLE_MAX = 500;
const DESCRIPTION_MAX = 10_000;
const NAME_MAX = 64;
// Collections and tags are created one command at a time; past this the import would mostly be
// waiting on round trips, and a file with this many folders wants reorganizing first anyway.
const MAX_NEW_TAXONOMY = 1_000;
// Each accepted chunk's change frame must stay under the 1 MiB command budget.
const CHUNK_BYTES = 600_000;
const CREATE_CHUNK = 50;
const SESSION_PREFIX = 'prism:browser-import:';

export type BrowserImportIssue = { url: string; path: string; reason: string };
export type PlannedBookmark = {
	url: string;
	canonicalUrl: string;
	title: string;
	description: string;
	createdAt: string | null;
	collection: string | null;
	tags: string[];
	/** Original folder path in the file, including any browser root container. */
	path: string;
};
export type TaxonomyPlan = { name: string; existing: boolean; isPrivate: boolean; count: number };
export type BrowserImportPlan = {
	fileName: string;
	fileHash: string;
	vaultId: string;
	seed: string;
	resumed: boolean;
	privateTag: string;
	keepPrivate: boolean;
	found: number;
	folders: number;
	containers: string[];
	bookmarks: PlannedBookmark[];
	/** Already in the vault before this import (same canonical URL). */
	existing: number;
	/** Created by an earlier attempt of this same import session. */
	previouslyImported: number;
	skipped: BrowserImportIssue[];
	adjustments: BrowserImportIssue[];
	reasons: { reason: string; count: number }[];
	collections: TaxonomyPlan[];
	tags: TaxonomyPlan[];
	mapping: { path: string; collection: string | null; tag: string | null; count: number }[];
	warnings: string[];
};
export type BrowserImportProgress = { phase: string; done: number; total: number };
export type BrowserImportReport = {
	format: 'prism-browser-import-report';
	version: 1;
	file: string;
	startedAt: string;
	finishedAt: string;
	status: 'complete' | 'stopped' | 'cancelled';
	error?: string;
	counts: {
		found: number;
		created: number;
		alreadyImported: number;
		existing: number;
		skipped: number;
		failed: number;
	};
	created: { id: string; url: string; path: string }[];
	skipped: BrowserImportIssue[];
	adjustments: BrowserImportIssue[];
	failed: BrowserImportIssue[];
	guidance: string[];
};
type Session = { seed: string; privateTag: string; keepPrivate: boolean; startedAt: string };

const live = (row: Row) => !row.deletedAt && !row.purgedAt;
const length = (value: string) => [...value].length;
const shorten = (value: string, max: number) =>
	length(value) > max ? [...value].slice(0, max - 1).join('') + '…' : value;
// Folder segments are escaped so a slash inside a folder name can't be mistaken for nesting.
const escapeSegment = (segment: string) => segment.replace(/\\/g, '\\\\').replace(/\//g, '\\/');
export const TAG_PATH_CONVENTION =
	'Nested folders become one tag named by their path below the top folder, joined with "/". A "/" or "\\" inside a folder name is written as "\\/" or "\\\\".';

async function sha256(text: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
/** A version-8 (custom) UUID derived from the session seed, stable across retries. */
async function derivedId(seed: string, label: string): Promise<string> {
	const bytes = (await sha256(`${seed}\n${label}`)).slice(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x80;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const h = hex(bytes);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const sessionKey = (vaultId: string, fileHash: string) => `${SESSION_PREFIX}${vaultId}:${fileHash}`;
function readSession(vaultId: string, fileHash: string): Session | null {
	try {
		const value = JSON.parse(localStorage.getItem(sessionKey(vaultId, fileHash)) ?? 'null');
		return value && typeof value.seed === 'string' && typeof value.privateTag === 'string'
			? value
			: null;
	} catch {
		return null;
	}
}
function writeSession(plan: BrowserImportPlan, startedAt: string) {
	const session: Session = {
		seed: plan.seed,
		privateTag: plan.privateTag,
		keepPrivate: plan.keepPrivate,
		startedAt
	};
	localStorage.setItem(sessionKey(plan.vaultId, plan.fileHash), JSON.stringify(session));
}
const clearSession = (plan: BrowserImportPlan) =>
	localStorage.removeItem(sessionKey(plan.vaultId, plan.fileHash));

/** Names keyed by normalized identity, so "Dev" and "dev" are one tag or collection. */
function nameIndex(client: LibraryClient, table: 'tags' | 'collections') {
	const index = new Map<string, Row>();
	for (const row of client.list<Row>(table).filter(live))
		index.set(normalizeOrganizationName(row.name).normalizedName, row);
	return index;
}
function liveUrls(client: LibraryClient) {
	const urls = new Map<string, string>();
	for (const row of client.list<Row>('bookmarks'))
		if (live(row) && typeof row.canonicalUrl === 'string')
			urls.set(row.canonicalUrl, String(row.id));
	return urls;
}

/** Reads the file and maps it onto the current vault. Writes nothing. */
export async function planBrowserImport(
	client: LibraryClient,
	text: string,
	fileName: string
): Promise<BrowserImportPlan> {
	const vaultId = client.state.identity?.vaultId;
	if (!vaultId) throw new Error('Load the library before importing.');
	if (new TextEncoder().encode(text).byteLength > BROWSER_IMPORT_MAX_BYTES)
		throw new Error('Choose a bookmark file smaller than 10 MiB.');
	const parsed = parseNetscape(text);
	const fileHash = hex(await sha256(text)).slice(0, 32);
	const session = readSession(vaultId, fileHash);
	const today = new Date().toISOString().slice(0, 10);
	const tagIndex = nameIndex(client, 'tags');
	let privateTag = session?.privateTag ?? `Browser import ${today}`;
	// A fresh session never adopts someone else's public tag as its privacy marker.
	for (
		let n = 2;
		!session && tagIndex.get(normalizeOrganizationName(privateTag).normalizedName);
		n++
	)
		privateTag = `Browser import ${today} (${n})`;
	const plan: BrowserImportPlan = {
		fileName,
		fileHash,
		vaultId,
		seed: session?.seed ?? crypto.randomUUID(),
		resumed: !!session,
		privateTag,
		keepPrivate: session?.keepPrivate ?? true,
		found: parsed.links.length,
		folders: parsed.folders,
		containers: parsed.containers,
		bookmarks: [],
		existing: 0,
		previouslyImported: 0,
		skipped: [],
		adjustments: [],
		reasons: [],
		collections: [],
		tags: [],
		mapping: [],
		warnings: []
	};
	if (!parsed.links.length)
		throw new Error(
			'No bookmarks were found in this file. Export bookmarks as HTML from your browser.'
		);
	if (parsed.invalidDates)
		plan.warnings.push(
			`${parsed.invalidDates} bookmark dates were unreadable or implausible; those bookmarks use the import time.`
		);
	if (parsed.flattenedDeepFolders)
		plan.warnings.push(
			`${parsed.flattenedDeepFolders} folders nested more than 32 deep were merged into their parent folder.`
		);

	const name = (raw: string, kind: string, path: string, url: string) => {
		const value = raw.replace(/\s+/gu, ' ').trim() || `Untitled ${kind}`;
		if (length(value) <= NAME_MAX) return value;
		const short = shorten(value, NAME_MAX);
		plan.adjustments.push({ url, path, reason: `${kind} name shortened to "${short}".` });
		return short;
	};
	const byUrl = new Map<string, PlannedBookmark>();
	const mapping = new Map<string, BrowserImportPlan['mapping'][number]>();
	for (const link of parsed.links) {
		const path = [link.container, ...link.path].filter(Boolean).join(' / ') || '(top level)';
		let canonicalUrl: string;
		try {
			canonicalUrl = normalizeUrl(link.href).canonicalUrl;
		} catch {
			const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link.href)?.[1]?.toLowerCase();
			plan.skipped.push({
				url: link.href.slice(0, 300),
				path,
				reason: !link.href
					? 'No URL.'
					: scheme && scheme !== 'http' && scheme !== 'https'
						? `Unsupported ${scheme}: link.`
						: 'Malformed or unsupported URL.'
			});
			continue;
		}
		const collection = link.path.length ? name(link.path[0], 'Collection', path, link.href) : null;
		const pathTag =
			link.path.length > 1
				? name(link.path.slice(1).map(escapeSegment).join('/'), 'Tag', path, link.href)
				: null;
		const mapKey = `${collection ?? ''}\n${pathTag ?? ''}`;
		const entry = mapping.get(mapKey) ?? { path, collection, tag: pathTag, count: 0 };
		entry.count++;
		mapping.set(mapKey, entry);
		const tags = [
			...(pathTag ? [pathTag] : []),
			...link.tags.map((tag) => name(tag, 'Tag', path, link.href))
		];
		let title = link.title || link.href;
		if (length(title) > TITLE_MAX) {
			title = shorten(title, TITLE_MAX);
			plan.adjustments.push({ url: link.href, path, reason: 'Title shortened to 500 characters.' });
		}
		let description = link.description;
		if (length(description) > DESCRIPTION_MAX) {
			description = shorten(description, DESCRIPTION_MAX);
			plan.adjustments.push({
				url: link.href,
				path,
				reason: 'Description shortened to 10,000 characters.'
			});
		}
		const first = byUrl.get(canonicalUrl);
		if (first) {
			// The first occurrence wins; its tags gain this copy's tags, and a different collection
			// is reported rather than silently dropped.
			first.tags.push(...tags);
			if (!first.description && description) first.description = description;
			plan.skipped.push({
				url: link.href,
				path,
				reason: `Duplicate in this file; merged into the copy in ${first.path}.`
			});
			if (collection !== first.collection)
				plan.adjustments.push({
					url: link.href,
					path,
					reason: `Also filed under ${collection ?? 'no collection'}; kept ${first.collection ?? 'no collection'} (a bookmark has one collection).`
				});
			continue;
		}
		byUrl.set(canonicalUrl, {
			url: link.href,
			canonicalUrl,
			title,
			description,
			createdAt: link.addedAt,
			collection,
			tags,
			path
		});
	}
	plan.mapping = [...mapping.values()];

	// Distinct tags per bookmark within the per-entity limit, privacy marker included.
	const tagLimit = MAX_ENTITY_TAGS - 1;
	for (const item of byUrl.values()) {
		const seen = new Set<string>();
		item.tags = item.tags.filter((tag) => {
			const key = normalizeOrganizationName(tag).normalizedName;
			return !seen.has(key) && !!seen.add(key);
		});
		if (item.tags.length > tagLimit) {
			plan.adjustments.push({
				url: item.url,
				path: item.path,
				reason: `Only the first ${tagLimit} of ${item.tags.length} tags were kept.`
			});
			item.tags = item.tags.slice(0, tagLimit);
		}
	}

	const urls = liveUrls(client);
	for (const item of byUrl.values()) {
		const ownId = await derivedId(plan.seed, `bookmark:${item.canonicalUrl}`);
		const existingId = urls.get(item.canonicalUrl);
		if (existingId && existingId !== ownId) {
			plan.existing++;
			plan.skipped.push({
				url: item.url,
				path: item.path,
				reason: 'Already in your library; its notes, tags and collection were left unchanged.'
			});
			continue;
		}
		if (existingId) plan.previouslyImported++;
		plan.bookmarks.push(item);
	}

	const collectionIndex = nameIndex(client, 'collections');
	const tally = (names: (string | null)[], index: Map<string, Row>) => {
		const counts = new Map<string, TaxonomyPlan>();
		for (const value of names) {
			if (!value) continue;
			const key = normalizeOrganizationName(value).normalizedName;
			const existing = index.get(key);
			const entry = counts.get(key) ?? {
				name: existing ? String(existing.name) : value,
				existing: !!existing,
				isPrivate: existing?.isPrivate === true,
				count: 0
			};
			entry.count++;
			counts.set(key, entry);
		}
		return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	};
	plan.collections = tally(
		plan.bookmarks.map((item) => item.collection),
		collectionIndex
	);
	plan.tags = tally(
		plan.bookmarks.flatMap((item) => item.tags),
		tagIndex
	);
	const fresh =
		plan.collections.filter((c) => !c.existing).length +
		plan.tags.filter((t) => !t.existing).length;
	if (fresh > MAX_NEW_TAXONOMY)
		throw new Error(
			`This file would create ${fresh.toLocaleString()} collections and tags (limit ${MAX_NEW_TAXONOMY.toLocaleString()}). Simplify its folders before importing.`
		);
	for (const tag of plan.tags)
		if (tag.existing && tag.isPrivate)
			plan.warnings.push(
				`"${tag.name}" is an existing private tag; bookmarks imported with it stay private.`
			);
	const reasons = new Map<string, number>();
	for (const issue of plan.skipped) {
		const reason = issue.reason.startsWith('Duplicate in this file')
			? 'Duplicate in this file'
			: issue.reason;
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
	}
	plan.reasons = [...reasons].map(([reason, count]) => ({ reason, count }));
	return plan;
}

class Stop extends Error {
	constructor(
		message: string,
		readonly cancelled = false
	) {
		super(message);
	}
}

/** Runs (or resumes) a planned import. Progress and partial results are always reported. */
export async function runBrowserImport(
	client: LibraryClient,
	plan: BrowserImportPlan,
	{
		signal,
		onProgress
	}: { signal?: AbortSignal; onProgress?: (progress: BrowserImportProgress) => void } = {}
): Promise<BrowserImportReport> {
	const startedAt = new Date().toISOString();
	const report: BrowserImportReport = {
		format: 'prism-browser-import-report',
		version: 1,
		file: plan.fileName,
		startedAt,
		finishedAt: startedAt,
		status: 'stopped',
		counts: {
			found: plan.found,
			created: 0,
			alreadyImported: 0,
			existing: 0,
			skipped: 0,
			failed: 0
		},
		created: [],
		skipped: [...plan.skipped.filter((issue) => !issue.reason.startsWith('Already in'))],
		adjustments: [...plan.adjustments],
		failed: [],
		guidance: [
			'Keep the original bookmark file. Choosing it again resumes this import without duplicating bookmarks that were already accepted.',
			'Prism records titles, URLs, descriptions, save dates, folders (as collections and tags) and browser tags. Icons, keywords and separators are not imported.'
		]
	};
	const progress = (phase: string, done: number, total: number) =>
		onProgress?.({ phase, done, total });
	const clear = () => {
		if (!client.state.online)
			throw new Stop(
				'You went offline. Accepted bookmarks are kept; choose the file again to resume.'
			);
		if (client.state.pending || client.state.conflicts.length)
			throw new Stop(
				'Sync has unsent or conflicting changes. Resolve them, then choose the file again to resume.'
			);
	};
	type Sent = { outcome: SaveOutcome; operationId: string };
	const send = async (raw: Command): Promise<Sent> => {
		if (signal?.aborted) throw new Stop('Import cancelled. Choose the file again to resume.', true);
		clear();
		const command = parseCommand(raw);
		const operationId = await derivedId(plan.seed, `op:${JSON.stringify(command)}`);
		const outcome = await client.save(command, { waitForSync: true, operationId });
		if (outcome.status === 'queued')
			throw new Stop(
				'The server did not confirm the last chunk; it stays queued on this device. Once it syncs, choose the file again to resume.'
			);
		return { outcome, operationId };
	};
	// A rejected import command is this import's own; discard it instead of leaving a conflict.
	const discard = async ({ outcome, operationId }: Sent) => {
		if (outcome.status !== 'accepted') await client.resolveConflict(operationId, 'remote');
	};
	const must = async (raw: Command, what: string) => {
		const sent = await send(raw);
		if (sent.outcome.status !== 'accepted') {
			await discard(sent);
			throw new Stop(`${what}: ${sent.outcome.message ?? sent.outcome.status}`);
		}
	};

	try {
		if (!client.state.ready) throw new Stop('Load the library before importing.');
		clear();
		await client.sync();
		if (client.state.error) throw new Stop('Synchronization must finish before importing.');
		clear();
		writeSession(plan, startedAt);

		// 1. Collections and tags, each matched by name before anything is created.
		const collectionIds = new Map<string, string>();
		const tagIds = new Map<string, string>();
		const neededCollections = new Set(plan.bookmarks.map((b) => b.collection).filter(Boolean));
		const neededTags = new Set(plan.bookmarks.flatMap((b) => b.tags));
		if (plan.keepPrivate) neededTags.add(plan.privateTag);
		const total = neededCollections.size + neededTags.size;
		let done = 0;
		for (const [table, names, ids] of [
			['collections', neededCollections, collectionIds],
			['tags', neededTags, tagIds]
		] as const) {
			const index = nameIndex(client, table);
			for (const value of names as Set<string>) {
				const { name, normalizedName } = normalizeOrganizationName(value);
				let row = index.get(normalizedName);
				if (!row) {
					const id = await derivedId(plan.seed, `${table}:${normalizedName}`);
					progress('Creating collections and tags', done, total);
					await must(
						{ type: table === 'tags' ? 'tag.create' : 'collection.create', id, name },
						`Could not create "${name}"`
					);
					row = client.get<Row>(table, id) ?? { id, name, revision: '1' };
				}
				ids.set(normalizedName, String(row.id));
				if (table === 'tags' && value === plan.privateTag && row.isPrivate !== true)
					await must(
						{
							type: 'tag.privacy',
							id: String(row.id),
							expectedRevision: String(row.revision ?? '1') as Revision,
							isPrivate: true
						},
						`Could not make "${name}" private`
					);
				progress('Creating collections and tags', ++done, total);
			}
		}

		// 2. Bookmarks: already created by this session, already in the vault, or new.
		type Owned = { item: PlannedBookmark; id: string };
		const owned: Owned[] = [];
		const pending: Owned[] = [];
		const urls = liveUrls(client);
		for (const item of plan.bookmarks) {
			const id = await derivedId(plan.seed, `bookmark:${item.canonicalUrl}`);
			const row = client.get<Row>('bookmarks', id);
			if (row) {
				if (live(row)) {
					owned.push({ item, id });
					report.counts.alreadyImported++;
				} else
					report.skipped.push({
						url: item.url,
						path: item.path,
						reason: 'Removed after an earlier attempt of this import; not recreated.'
					});
			} else if (urls.has(item.canonicalUrl)) {
				report.counts.existing++;
				report.skipped.push({
					url: item.url,
					path: item.path,
					reason: 'Saved to your library since the preview; left unchanged.'
				});
			} else pending.push({ item, id });
		}
		report.counts.existing += plan.existing;
		const createOf = ({ item, id }: Owned): BulkBookmarkCommand => ({
			type: 'bookmark.create',
			id,
			kind: inferBookmarkKind(item.url),
			title: item.title,
			description: item.description,
			url: item.url,
			...(item.createdAt ? { createdAt: item.createdAt } : {})
		});
		// A change frame repeats each bookmark's projection, so bound chunks by size too.
		const weight = ({ item }: Owned) =>
			serializedBytes({ t: item.title, d: item.description, u: item.url }) + 700;
		const chunks = <T extends Owned>(items: T[], max: number) => {
			const out: T[][] = [];
			let current: T[] = [],
				bytes = 0;
			for (const entry of items) {
				const size = weight(entry);
				if (current.length && (current.length >= max || bytes + size > CHUNK_BYTES)) {
					out.push(current);
					current = [];
					bytes = 0;
				}
				current.push(entry);
				bytes += size;
			}
			if (current.length) out.push(current);
			return out;
		};
		const accept = (entry: Owned) => {
			owned.push(entry);
			report.counts.created++;
			report.created.push({ id: entry.id, url: entry.item.url, path: entry.item.path });
		};
		const fail = (entry: Owned, reason: string) => {
			report.failed.push({ url: entry.item.url, path: entry.item.path, reason });
			report.counts.failed++;
		};
		let created = 0;
		for (const chunk of chunks(pending, CREATE_CHUNK)) {
			progress('Saving bookmarks', created, pending.length);
			const sent = await send({ type: 'bookmark.bulk', commands: chunk.map(createOf) });
			if (sent.outcome.status === 'accepted') chunk.forEach(accept);
			else {
				// One bad item (often a URL saved elsewhere meanwhile) rejects the chunk; isolate it.
				await discard(sent);
				for (const entry of chunk) {
					const single = await send(createOf(entry));
					if (single.outcome.status === 'accepted') accept(entry);
					else {
						await discard(single);
						if (single.outcome.status === 'already_exists') {
							report.counts.existing++;
							report.skipped.push({
								url: entry.item.url,
								path: entry.item.path,
								reason: 'Saved to your library during the import; left unchanged.'
							});
						} else fail(entry, single.outcome.message ?? 'Rejected by the server.');
					}
				}
			}
			created += chunk.length;
		}
		progress('Saving bookmarks', pending.length, pending.length);

		// 3. Tags. A bulk command names each bookmark once, so each round adds one missing tag each.
		const wantedTags = (item: PlannedBookmark) =>
			[...item.tags, ...(plan.keepPrivate ? [plan.privateTag] : [])]
				.map((tag) => tagIds.get(normalizeOrganizationName(tag).normalizedName))
				.filter((id): id is string => !!id);
		const missing = (entry: Owned) => {
			const current = new Set((client.get<Row>('bookmarks', entry.id)?.tagIds as string[]) ?? []);
			return wantedTags(entry.item).filter((id) => !current.has(id));
		};
		const tagTotal = owned.reduce((sum, entry) => sum + missing(entry).length, 0);
		let tagged = 0;
		const gaveUp = new Set<string>();
		for (;;) {
			const round = owned
				.map((entry) => ({
					...entry,
					tagId: missing(entry).find((id) => !gaveUp.has(`${entry.id}/${id}`))
				}))
				.filter((entry): entry is Owned & { tagId: string } => !!entry.tagId);
			if (!round.length) break;
			for (const chunk of chunks(round, MAX_BULK_BOOKMARKS)) {
				progress('Adding tags', tagged, tagTotal);
				const add = (e: (typeof chunk)[number]) => ({
					type: 'tag.add' as const,
					id: e.id,
					tagId: e.tagId
				});
				const sent = await send({ type: 'bookmark.bulk', commands: chunk.map(add) });
				if (sent.outcome.status !== 'accepted') {
					await discard(sent);
					for (const entry of chunk) {
						const single = await send(add(entry));
						if (single.outcome.status !== 'accepted') {
							await discard(single);
							gaveUp.add(`${entry.id}/${entry.tagId}`);
							report.adjustments.push({
								url: entry.item.url,
								path: entry.item.path,
								reason: `A tag was not added: ${single.outcome.message ?? 'rejected'}`
							});
						}
					}
				}
				tagged += chunk.length;
			}
		}

		// 4. Collections, against each bookmark's current revision.
		const filing = () =>
			owned.filter((entry) => {
				const target = entry.item.collection
					? collectionIds.get(normalizeOrganizationName(entry.item.collection).normalizedName)
					: undefined;
				return target && client.get<Row>('bookmarks', entry.id)?.collectionId !== target;
			});
		const organize = (entry: Owned): BulkBookmarkCommand => ({
			type: 'bookmark.organize',
			id: entry.id,
			expectedRevision: String(client.get<Row>('bookmarks', entry.id)?.revision) as Revision,
			patch: {
				collectionId: collectionIds.get(
					normalizeOrganizationName(entry.item.collection).normalizedName
				)!
			}
		});
		const toFile = filing();
		let filed = 0;
		for (const chunk of chunks(toFile, MAX_BULK_BOOKMARKS)) {
			progress('Filing into collections', filed, toFile.length);
			const sent = await send({ type: 'bookmark.bulk', commands: chunk.map(organize) });
			if (sent.outcome.status !== 'accepted') {
				await discard(sent);
				for (const entry of chunk) {
					const single = await send(organize(entry));
					if (single.outcome.status !== 'accepted') {
						await discard(single);
						report.adjustments.push({
							url: entry.item.url,
							path: entry.item.path,
							reason: `Not filed into "${entry.item.collection}": ${single.outcome.message ?? 'rejected'}`
						});
					}
				}
			}
			filed += chunk.length;
		}
		progress('Filing into collections', toFile.length, toFile.length);

		report.status = 'complete';
		clearSession(plan);
	} catch (error) {
		if (error instanceof Stop && error.cancelled) report.status = 'cancelled';
		report.error = error instanceof Error ? error.message : String(error);
	}
	report.counts.skipped = report.skipped.length;
	report.finishedAt = new Date().toISOString();
	return report;
}

export type BrowserExport = {
	html: string;
	exported: number;
	/** Text notes and rabbit holes have no URL; they stay in the Prism JSON export. */
	withoutUrl: number;
	/** Private tag names are left out of the file's TAGS; the bookmarks themselves are included. */
	privateTagsOmitted: number;
};

/** Active URL bookmarks as a standard bookmark file. Collections become folders. */
export function exportBrowserBookmarks(client: LibraryClient): BrowserExport {
	const tags = new Map(
		client
			.listConfirmed<Row>('tags')
			.filter(live)
			.map((t) => [String(t.id), t])
	);
	const collections = new Map(
		client
			.listConfirmed<Row>('collections')
			.filter(live)
			.map((c) => [String(c.id), String(c.name)])
	);
	const root: NetscapeExportLink[] = [];
	const folders = new Map<string, NetscapeExportFolder>();
	let withoutUrl = 0,
		privateTagsOmitted = 0;
	const rows = client
		.listConfirmed<Row>('bookmarks')
		.filter(live)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
	for (const row of rows) {
		if (typeof row.url !== 'string' || !row.url) {
			withoutUrl++;
			continue;
		}
		const names: string[] = [];
		for (const id of (row.tagIds as string[] | undefined) ?? []) {
			const tag = tags.get(id);
			if (!tag) continue;
			if (tag.isPrivate === true) privateTagsOmitted++;
			// TAGS is comma-separated, so a name containing a comma can't be represented.
			else if (!String(tag.name).includes(',')) names.push(String(tag.name));
		}
		const link: NetscapeExportLink = {
			title: String(row.title ?? ''),
			url: row.url,
			addedAt: typeof row.createdAt === 'string' ? row.createdAt : null,
			modifiedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
			tags: names,
			description: String(row.description ?? '')
		};
		const folder = row.collectionId ? collections.get(String(row.collectionId)) : undefined;
		if (!folder) root.push(link);
		else {
			const entry = folders.get(String(row.collectionId)) ?? { title: folder, links: [] };
			entry.links.push(link);
			folders.set(String(row.collectionId), entry);
		}
	}
	const ordered = [...folders.values()].sort((a, b) => a.title.localeCompare(b.title));
	return {
		html: serializeNetscape(root, ordered),
		exported: rows.length - withoutUrl,
		withoutUrl,
		privateTagsOmitted
	};
}
