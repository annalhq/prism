import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { MAX_COMMAND_BYTES, serializedBytes, type Sequence } from '#lib/domain/contracts.js';
import {
	BOOTSTRAP_BATCH_CAPABILITY,
	REPLICA_TABLES,
	type BootstrapPage,
	type BootstrapStart,
	type ReplicaRecord,
	type ReplicaTable
} from '#lib/domain/replica.js';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import { syncLeases } from '../db/schema.js';
import { ApiError } from '../http.js';
import { bookmarkProjections, entityProjections, personProjections } from './projections.js';
import { linkEdges } from './links.js';
import { ownerVault } from './sync.js';
import { encodeCursor } from './cursors.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const sources: Record<
	ReplicaTable,
	{ name: string; key: string; owner?: string; secondOwner?: string }
> = {
	entities: { name: 'knowledge_entities', key: 't.id::text' },
	bookmarks: { name: 'bookmarks', key: 't.id::text', owner: 'id' },
	people: { name: 'people', key: 't.id::text', owner: 'id' },
	personas: { name: 'personas', key: 't.id::text', owner: 'id' },
	notes: { name: 'entity_notes', key: 't.entity_id::text', owner: 'entity_id' },
	tags: { name: 'tags', key: 't.id::text' },
	collections: { name: 'collections', key: 't.id::text' },
	links: { name: 'knowledge_entities', key: 't.id::text', owner: 'id' },
	identities: { name: 'person_identities', key: 't.id::text', owner: 'person_id' },
	relationships: {
		name: 'content_people',
		key: "t.bookmark_id::text || '/' || t.person_id::text || '/' || t.role::text",
		owner: 'bookmark_id',
		secondOwner: 'person_id'
	},
	memberships: {
		name: 'persona_members',
		key: "t.persona_id::text || '/' || t.member_id::text",
		owner: 'persona_id',
		secondOwner: 'member_id'
	},
	savedSearches: { name: 'saved_searches', key: 't.id::text' },
	activity: { name: 'bookmark_activity', key: 't.bookmark_id::text', owner: 'bookmark_id' },
	folders: { name: 'tag_folders', key: 't.id::text' }
};
export async function startBootstrap(owner: OwnerContext): Promise<BootstrapStart> {
	return inTransaction(async (tx) => {
		const vault = await ownerVault(tx, owner, true);
		const token = `${vault.syncEpoch}.${randomBytes(32).toString('hex')}`;
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
		await tx.insert(syncLeases).values({
			vaultId: owner.vaultId,
			tokenHash: hash(token),
			startSeq: vault.changeSeq,
			expiresAt
		});
		return {
			token,
			epoch: vault.syncEpoch,
			startSeq: String(vault.changeSeq) as Sequence,
			cursor: encodeCursor(owner.vaultId, vault.syncEpoch, vault.changeSeq),
			tables: REPLICA_TABLES,
			expiresAt: expiresAt.toISOString(),
			capabilities: [BOOTSTRAP_BATCH_CAPABILITY]
		};
	});
}
async function requireLease(tx: Transaction, owner: OwnerContext, token: string) {
	const vault = await ownerVault(tx, owner);
	if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token) || !token.startsWith(`${vault.syncEpoch}.`))
		throw new ApiError(
			410,
			'reset_required',
			'Bootstrap expired. Preserve pending work and restart.'
		);
	const [lease] = await tx
		.select()
		.from(syncLeases)
		.where(and(eq(syncLeases.vaultId, owner.vaultId), eq(syncLeases.tokenHash, hash(token))));
	if (!lease || lease.expiresAt.getTime() <= Date.now() || lease.startSeq < vault.retentionFloor)
		throw new ApiError(
			410,
			'reset_required',
			'Bootstrap lease expired. Preserve pending work and restart.'
		);
}
export async function releaseBootstrap(owner: OwnerContext, token: string) {
	if (token.length > 128) throw new ApiError(400, 'invalid_token', 'Invalid bootstrap token.');
	return inTransaction(async (tx) => {
		await ownerVault(tx, owner);
		await tx
			.delete(syncLeases)
			.where(and(eq(syncLeases.vaultId, owner.vaultId), eq(syncLeases.tokenHash, hash(token))));
	});
}
function camelRow(raw: Record<string, unknown>): Record<string, unknown> {
	const privateKeys = new Set([
		'vault_id',
		'url_hash',
		'persona_name',
		'entity_kind',
		'profile_url_hash'
	]);
	return Object.fromEntries(
		Object.entries(raw)
			.filter(([key]) => !privateKeys.has(key))
			.map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value])
	);
}
type Prepared = {
	bookmarks?: Map<string, Record<string, unknown>>;
	people?: Map<string, Record<string, unknown>>;
	entities?: Map<string, Record<string, unknown>>;
	edges?: Map<string, unknown[]>;
};
const rowId = (raw: Record<string, unknown>) => String(raw.id ?? raw.entity_id ?? raw.bookmark_id);

/**
 * Everything a page's rows need beyond their own columns, fetched in a few queries for the whole
 * page. Building each row on its own took several round trips per row; on a remote database a
 * 200-row page then ran past the client's timeout, so a new browser could never finish.
 */
async function prepare(
	tx: Transaction,
	vaultId: string,
	table: ReplicaTable,
	raws: Record<string, unknown>[]
): Promise<Prepared> {
	const ids = raws.map(rowId);
	if (table === 'bookmarks') return { bookmarks: await bookmarkProjections(tx, vaultId, ids) };
	if (table === 'people') return { people: await personProjections(tx, vaultId, ids) };
	if (table === 'personas') return { entities: await entityProjections(tx, vaultId, ids) };
	if (table === 'entities')
		return {
			entities: await entityProjections(
				tx,
				vaultId,
				raws.filter((raw) => !raw.purged_at).map(rowId)
			)
		};
	if (table === 'links') return { edges: await linkEdges(tx, vaultId, ids) };
	return {};
}

function project(
	prepared: Prepared,
	table: ReplicaTable,
	key: string,
	raw: Record<string, unknown>
): ReplicaRecord {
	let value = camelRow(raw);
	const id = rowId(raw);
	const required = <T>(found: T | undefined): T => {
		if (found === undefined) throw new Error('Bootstrap projection invariant failed.');
		return found;
	};
	if (table === 'bookmarks') value = required(prepared.bookmarks?.get(id));
	if (table === 'people') value = required(prepared.people?.get(id));
	if (table === 'entities') {
		value = raw.purged_at
			? {
					id,
					kind: raw.kind,
					revision: raw.revision,
					lastSeq: raw.last_seq,
					deletedAt: raw.deleted_at,
					purgedAt: raw.purged_at
				}
			: required(prepared.entities?.get(id));
	}
	if (table === 'personas') {
		const entity = required(prepared.entities?.get(id));
		value = { ...entity, kind: 'persona', name: raw.name, description: raw.description };
	}
	if (table === 'memberships') {
		value.member = { kind: value.memberKind, id: value.memberId };
		delete value.memberKind;
		delete value.memberId;
		delete value.purgedAt;
	}
	if (
		table === 'identities' ||
		table === 'relationships' ||
		table === 'tags' ||
		table === 'collections' ||
		table === 'folders' ||
		table === 'savedSearches'
	)
		delete value.purgedAt;
	if (table === 'links')
		value = {
			sourceId: id,
			lastSeq: String(BigInt(String(raw.last_seq))) as Sequence,
			edges: prepared.edges?.get(id) ?? []
		};
	return { table, key, lastSeq: String(value.lastSeq) as Sequence, value };
}
type SourceRow = { key: string; data: Record<string, unknown> };

/** One statement over a replicated table: `range` narrows past a continuation, `order` sorts. */
function selectRows(
	tx: Transaction,
	owner: OwnerContext,
	table: ReplicaTable,
	range: SQL,
	order: SQL,
	limit: number
) {
	const source = sources[table];
	const liveOwner = (column: string) =>
		sql`exists(select 1 from knowledge_entities e where e.vault_id = t.vault_id and e.id = ${sql.raw(`t.${column}`)} and e.purged_at is null)`;
	// jsonb overrides preserve bigint precision before PostgreSQL serializes the row.
	const revision = ['bookmarks', 'people', 'personas'].includes(table)
		? sql`'{}'::jsonb`
		: sql`jsonb_build_object('revision', t.revision::text, 'last_seq', t.last_seq::text)`;
	const extras =
		table === 'activity'
			? sql`jsonb_build_object('open_count', t.open_count::text)`
			: table === 'links'
				? sql`jsonb_build_object('last_seq', greatest(t.last_seq, coalesce((select n.last_seq from entity_notes n where n.vault_id=t.vault_id and n.entity_id=t.id),0))::text)`
				: sql`'{}'::jsonb`;
	return tx.execute<SourceRow>(
		sql`select ${sql.raw(source.key)} as key, to_jsonb(t) || ${revision} || ${extras} as data from ${sql.raw(source.name)} t where t.vault_id = ${owner.vaultId}::uuid and ${range} ${source.owner ? sql`and ${liveOwner(source.owner)}` : sql``} ${source.secondOwner ? sql`and ${liveOwner(source.secondOwner)}` : sql``} order by ${order} limit ${limit}`
	);
}

/**
 * Projects fetched rows in order while `fits` accepts them, stopping at the first that doesn't.
 * `fits` gets the serialized size of the records so far (without separators), their count, and
 * the next record's size; `bytes` is returned in the same terms.
 */
async function projectRows(
	tx: Transaction,
	owner: OwnerContext,
	table: ReplicaTable,
	rows: SourceRow[],
	fits: (recordBytes: number, count: number, size: number, key: string) => boolean
) {
	const prepared = await prepare(
		tx,
		owner.vaultId,
		table,
		rows.map((row) => row.data)
	);
	const records: ReplicaRecord[] = [];
	// A running total of the records' own sizes, so the page is never re-serialised per row.
	let bytes = 0;
	for (const row of rows) {
		const record = project(prepared, table, row.key, row.data);
		const size = serializedBytes(record);
		if (!fits(bytes, records.length, size, row.key)) break;
		records.push(record);
		bytes += size;
	}
	return { records, bytes };
}

const tooLarge = () =>
	new ApiError(413, 'record_too_large', 'A replicated record exceeds the page budget.');

/** One table, one page: the original per-table transport, kept unchanged for older clients. */
export async function bootstrapPage(
	owner: OwnerContext,
	token: string,
	table: string,
	after = ''
): Promise<BootstrapPage> {
	if (!REPLICA_TABLES.includes(table as ReplicaTable) || after.length > 256)
		throw new ApiError(400, 'invalid_page', 'Invalid bootstrap table or continuation.');
	const selected = table as ReplicaTable;
	return inTransaction(
		async (tx) => {
			await requireLease(tx, owner, token);
			const key = sql.raw(sources[selected].key);
			// Stable immutable keys; each statement scans at most 201 rows, never the whole vault.
			const rows = await selectRows(tx, owner, selected, sql`${key} > ${after}`, key, 201);
			const { records } = await projectRows(
				tx,
				owner,
				selected,
				rows.rows.slice(0, 200),
				// The envelope with this row's continuation key, the records, and `count` commas.
				(bytes, count, size, rowKey) =>
					serializedBytes({ records: [], nextAfter: rowKey }) + bytes + size + count <=
					MAX_COMMAND_BYTES
			);
			if (!records.length && rows.rows.length) throw tooLarge();
			return { records, nextAfter: rows.rows.length > records.length ? records.at(-1)!.key : null };
		},
		{ isolationLevel: 'repeatable read', accessMode: 'read only' }
	);
}

// ---------------------------------------------------------------------------------------------
// Batched bootstrap (capability `bootstrap-batch-v1`): many tables per request.

const BATCH_RECORDS = 200;
// Checked between table segments only: a running statement is bounded by statement_timeout.
const BATCH_SERVICE_MS = 8_000;
const MAX_CONTINUATION = 256;
// Envelope with the longest continuation the budget allows, reserved before any record is added.
const BATCH_ENVELOPE = serializedBytes({ records: [], nextAfter: 'x'.repeat(MAX_CONTINUATION) });

// Each table's immutable key as native columns, so a continuation is a keyset seek on the key's
// own type instead of sorting text casts. The emitted record key stays the text form above.
const keyColumns: Record<ReplicaTable, readonly { column: string; type: string }[]> = {
	entities: [{ column: 'id', type: 'uuid' }],
	bookmarks: [{ column: 'id', type: 'uuid' }],
	people: [{ column: 'id', type: 'uuid' }],
	personas: [{ column: 'id', type: 'uuid' }],
	notes: [{ column: 'entity_id', type: 'uuid' }],
	tags: [{ column: 'id', type: 'uuid' }],
	collections: [{ column: 'id', type: 'uuid' }],
	links: [{ column: 'id', type: 'uuid' }],
	identities: [{ column: 'id', type: 'uuid' }],
	relationships: [
		{ column: 'bookmark_id', type: 'uuid' },
		{ column: 'person_id', type: 'uuid' },
		{ column: 'role', type: 'person_role' }
	],
	memberships: [
		{ column: 'persona_id', type: 'uuid' },
		{ column: 'member_id', type: 'uuid' }
	],
	savedSearches: [{ column: 'id', type: 'uuid' }],
	activity: [{ column: 'bookmark_id', type: 'uuid' }],
	folders: [{ column: 'id', type: 'uuid' }]
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyFormats: Record<ReplicaTable, RegExp> = Object.fromEntries(
	REPLICA_TABLES.map((table) => [
		table,
		table === 'relationships'
			? new RegExp(`^${UUID}/${UUID}/(author|about|related)$`)
			: table === 'memberships'
				? new RegExp(`^${UUID}/${UUID}$`)
				: new RegExp(`^${UUID}$`)
	])
) as Record<ReplicaTable, RegExp>;

type Continuation = { table: number; key: string | null };

// Bound to the lease, so a continuation from another bootstrap is rejected rather than reused.
const leaseTag = (token: string) => hash(token).slice(0, 32);

function encodeContinuation(token: string, position: Continuation): string {
	const value = Buffer.from(
		JSON.stringify({ v: 1, l: leaseTag(token), t: position.table, k: position.key })
	).toString('base64url');
	if (value.length > MAX_CONTINUATION)
		throw new Error('Bootstrap continuation exceeds its budget.');
	return value;
}

function decodeContinuation(token: string, input: string): Continuation {
	const invalid = () =>
		new ApiError(400, 'invalid_page', 'Invalid bootstrap table or continuation.');
	if (!input) return { table: 0, key: null };
	if (input.length > MAX_CONTINUATION || !/^[A-Za-z0-9_-]+$/.test(input)) throw invalid();
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
	} catch {
		throw invalid();
	}
	const { v, l, t, k } = (value ?? {}) as Record<string, unknown>;
	if (
		v !== 1 ||
		typeof t !== 'number' ||
		!Number.isInteger(t) ||
		t < 0 ||
		t >= REPLICA_TABLES.length ||
		!(k === null || (typeof k === 'string' && keyFormats[REPLICA_TABLES[t]].test(k))) ||
		Object.keys(value as object).length !== 4
	)
		throw invalid();
	if (l !== leaseTag(token))
		throw new ApiError(410, 'reset_required', 'Bootstrap continuation belongs to another lease.');
	return { table: t, key: k as string | null };
}

function seekAfter(table: ReplicaTable, key: string | null): SQL {
	if (key === null) return sql`true`;
	const columns = keyColumns[table];
	const values = key.split('/');
	const left = sql.join(
		columns.map(({ column }) => sql.raw(`t.${column}`)),
		sql`, `
	);
	const right = sql.join(
		columns.map(({ type }, index) => sql`${values[index]}::${sql.raw(type)}`),
		sql`, `
	);
	return sql`(${left}) > (${right})`;
}

const keyOrder = (table: ReplicaTable) =>
	sql.raw(keyColumns[table].map(({ column }) => `t.${column}`).join(', '));

/**
 * Up to 200 records across consecutive tables in one consistent read. The continuation names the
 * last emitted row (never a fetched-but-omitted one); null means every table has been visited,
 * including empty ones.
 */
export async function bootstrapBatchPage(
	owner: OwnerContext,
	token: string,
	after = ''
): Promise<BootstrapPage> {
	const start = decodeContinuation(token, after);
	return inTransaction(
		async (tx) => {
			await requireLease(tx, owner, token);
			let position = start;
			const started = performance.now();
			const records: ReplicaRecord[] = [];
			let bytes = BATCH_ENVELOPE;
			for (
				let segments = 0;
				position.table < REPLICA_TABLES.length &&
				segments < REPLICA_TABLES.length &&
				records.length < BATCH_RECORDS &&
				!(segments && performance.now() - started > BATCH_SERVICE_MS);
				segments++
			) {
				const table = REPLICA_TABLES[position.table];
				const wanted = BATCH_RECORDS - records.length;
				const rows = await selectRows(
					tx,
					owner,
					table,
					seekAfter(table, position.key),
					keyOrder(table),
					wanted + 1
				);
				const page = rows.rows.slice(0, wanted);
				const before = records.length;
				const segment = await projectRows(
					tx,
					owner,
					table,
					page,
					// `count` commas within the segment, and one joining it to earlier records.
					(segmentBytes, count, size) =>
						bytes + segmentBytes + size + count + (before ? 1 : 0) <= MAX_COMMAND_BYTES
				);
				if (segment.records.length < page.length) {
					// The byte budget is full. An individually oversized record can never fit.
					if (!records.length && !segment.records.length) throw tooLarge();
					records.push(...segment.records);
					if (segment.records.length)
						position = { table: position.table, key: segment.records.at(-1)!.key };
					break;
				}
				records.push(...segment.records);
				const added = segment.records.length;
				if (added) bytes += segment.bytes + (added - 1) + (before ? 1 : 0);
				position =
					rows.rows.length > page.length
						? { table: position.table, key: segment.records.at(-1)!.key }
						: { table: position.table + 1, key: null };
			}
			return {
				records,
				nextAfter:
					position.table < REPLICA_TABLES.length ? encodeContinuation(token, position) : null
			};
		},
		{ isolationLevel: 'repeatable read', accessMode: 'read only' }
	);
}
