import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { MAX_COMMAND_BYTES, serializedBytes, type Sequence } from '#lib/domain/contracts.js';
import {
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
import { bookmarkProjection, entityProjection, personProjection } from './projections.js';
import { linkProjection } from './links.js';
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
	activity: { name: 'bookmark_activity', key: 't.bookmark_id::text', owner: 'bookmark_id' }
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
			expiresAt: expiresAt.toISOString()
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
async function project(
	tx: Transaction,
	vaultId: string,
	table: ReplicaTable,
	key: string,
	raw: Record<string, unknown>
): Promise<ReplicaRecord> {
	let value = camelRow(raw);
	const id = String(raw.id ?? raw.entity_id ?? raw.bookmark_id);
	if (table === 'bookmarks') value = await bookmarkProjection(tx, vaultId, id);
	if (table === 'people') value = await personProjection(tx, vaultId, id);
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
			: await entityProjection(tx, vaultId, id);
	}
	if (table === 'personas') {
		const entity = await entityProjection(tx, vaultId, id);
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
		table === 'savedSearches'
	)
		delete value.purgedAt;
	if (table === 'links')
		value = await linkProjection(tx, vaultId, id, BigInt(String(raw.last_seq)));
	return { table, key, lastSeq: String(value.lastSeq) as Sequence, value };
}
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
			const source = sources[selected];
			const liveOwner = (column: string) =>
				sql`exists(select 1 from knowledge_entities e where e.vault_id = t.vault_id and e.id = ${sql.raw(`t.${column}`)} and e.purged_at is null)`;
			// Stable immutable keys; each statement scans at most 201 rows, never the whole vault.
			// jsonb overrides preserve bigint precision before PostgreSQL serializes the row.
			const revision = ['bookmarks', 'people', 'personas'].includes(selected)
				? sql`'{}'::jsonb`
				: sql`jsonb_build_object('revision', t.revision::text, 'last_seq', t.last_seq::text)`;
			const extras =
				selected === 'activity'
					? sql`jsonb_build_object('open_count', t.open_count::text)`
					: selected === 'links'
						? sql`jsonb_build_object('last_seq', greatest(t.last_seq, coalesce((select n.last_seq from entity_notes n where n.vault_id=t.vault_id and n.entity_id=t.id),0))::text)`
						: sql`'{}'::jsonb`;
			const rows = await tx.execute<{ key: string; data: Record<string, unknown> }>(
				sql`select ${sql.raw(source.key)} as key, to_jsonb(t) || ${revision} || ${extras} as data from ${sql.raw(source.name)} t where t.vault_id = ${owner.vaultId}::uuid and ${sql.raw(source.key)} > ${after} ${source.owner ? sql`and ${liveOwner(source.owner)}` : sql``} ${source.secondOwner ? sql`and ${liveOwner(source.secondOwner)}` : sql``} order by ${sql.raw(source.key)} limit 201`
			);
			const records: ReplicaRecord[] = [];
			for (const row of rows.rows.slice(0, 200)) {
				const record = await project(tx, owner.vaultId, selected, row.key, row.data);
				if (
					serializedBytes({ records: [...records, record], nextAfter: row.key }) > MAX_COMMAND_BYTES
				) {
					if (!records.length)
						throw new ApiError(
							413,
							'record_too_large',
							'A replicated record exceeds the page budget.'
						);
					break;
				}
				records.push(record);
			}
			return { records, nextAfter: rows.rows.length > records.length ? records.at(-1)!.key : null };
		},
		{ isolationLevel: 'repeatable read', accessMode: 'read only' }
	);
}
