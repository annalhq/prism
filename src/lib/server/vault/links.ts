import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type {
	Change,
	LinkProjection,
	RelatedLinkCommand,
	Revision,
	Sequence
} from '#lib/domain/contracts.js';
import { noteSnippet, type EntityKind } from '#lib/domain/notes.js';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import { bookmarks, entities, entityLinks, notes, people, personas } from '../db/schema.js';
import { findEntity, requireEntity, requireTargetKind } from './entities.js';
import { ApiError } from '../http.js';
import { bookmarkProjection } from './projections.js';
import { reject } from './rejections.js';

export async function linkProjection(
	tx: Transaction,
	vaultId: string,
	sourceId: string,
	seq: bigint
): Promise<LinkProjection> {
	const edges = await tx
		.select({ targetId: entityLinks.targetId, kind: entityLinks.kind })
		.from(entityLinks)
		.where(and(eq(entityLinks.vaultId, vaultId), eq(entityLinks.sourceId, sourceId)))
		.orderBy(entityLinks.targetId, entityLinks.kind);
	return { sourceId, lastSeq: String(seq) as Sequence, edges };
}
export async function changeRelatedLink(
	tx: Transaction,
	vaultId: string,
	command: RelatedLinkCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const source = await requireEntity(tx, vaultId, command.id, true);
	if (String(source.revision) !== command.expectedRevision)
		reject(
			'revision_conflict',
			'This entity changed. Review its current version before changing related links.',
			{ id: source.id, currentRevision: String(source.revision) as Revision }
		);
	const target = await requireEntity(tx, vaultId, command.target.id);
	requireTargetKind(target, command.target);
	if (command.type === 'related-link.add' && target.purgedAt)
		reject('purged', 'A related link cannot be added to a permanently removed entity.', {
			id: target.id
		});
	const edge = { vaultId, sourceId: source.id, targetId: target.id, kind: 'related' as const };
	if (command.type === 'related-link.add')
		await tx.insert(entityLinks).values(edge).onConflictDoNothing();
	else
		await tx
			.delete(entityLinks)
			.where(
				and(
					eq(entityLinks.vaultId, vaultId),
					eq(entityLinks.sourceId, source.id),
					eq(entityLinks.targetId, target.id),
					eq(entityLinks.kind, 'related')
				)
			);
	const [updated] = await tx
		.update(entities)
		.set({ revision: source.revision + 1n, lastSeq: seq, updatedAt: now })
		.where(and(eq(entities.vaultId, vaultId), eq(entities.id, source.id)))
		.returning();
	const metadata: Change =
		source.kind === 'bookmark'
			? { type: 'bookmark.upsert', bookmark: await bookmarkProjection(tx, vaultId, source.id) }
			: {
					type: 'entity.upsert',
					entity: {
						id: updated.id,
						kind: updated.kind,
						revision: String(updated.revision) as Revision,
						lastSeq: String(updated.lastSeq) as Sequence,
						deletedAt: updated.deletedAt?.toISOString() ?? null,
						purgedAt: updated.purgedAt?.toISOString() ?? null,
						createdAt: updated.createdAt.toISOString(),
						updatedAt: updated.updatedAt.toISOString()
					}
				};
	return [
		metadata,
		{ type: 'links.replace', links: await linkProjection(tx, vaultId, source.id, seq) }
	];
}

// Query one source row regardless of how many edge kinds connect it. Resolve labels
// at read time so renames cannot leave stale names or copied profile data in links.
export async function readBacklinks(owner: OwnerContext, targetId: string, after?: string) {
	return inTransaction(async (tx) => {
		const target = await findEntity(tx, owner.vaultId, targetId);
		if (!target) throw new ApiError(404, 'not_found', 'Backlink target was not found.');
		if (target.purgedAt) return { items: [], nextAfter: null };
		const related = sql<boolean>`exists(select 1 from entity_links l where l.vault_id = ${entities.vaultId} and l.source_id = ${entities.id} and l.target_id = ${targetId}::uuid and l.kind = 'related')`;
		const mentioned = sql<boolean>`exists(select 1 from entity_links l where l.vault_id = ${entities.vaultId} and l.source_id = ${entities.id} and l.target_id = ${targetId}::uuid and l.kind = 'note_reference')`;
		const rows = await tx
			.select({
				id: entities.id,
				kind: entities.kind,
				title: sql<string>`coalesce(${bookmarks.title}, ${people.displayName}, ${personas.name}, '')`,
				body: notes.bodyMarkdown,
				mentioned,
				related
			})
			.from(entities)
			.leftJoin(
				bookmarks,
				and(eq(bookmarks.vaultId, entities.vaultId), eq(bookmarks.id, entities.id))
			)
			.leftJoin(people, and(eq(people.vaultId, entities.vaultId), eq(people.id, entities.id)))
			.leftJoin(personas, and(eq(personas.vaultId, entities.vaultId), eq(personas.id, entities.id)))
			.leftJoin(notes, and(eq(notes.vaultId, entities.vaultId), eq(notes.entityId, entities.id)))
			.where(
				and(
					eq(entities.vaultId, owner.vaultId),
					isNull(entities.deletedAt),
					isNull(entities.purgedAt),
					ne(entities.id, targetId),
					// Recheck in this statement's snapshot: a purge can commit after the
					// initial target lookup under PostgreSQL's read-committed isolation.
					sql`exists(select 1 from knowledge_entities target where target.vault_id = ${owner.vaultId}::uuid and target.id = ${targetId}::uuid and target.purged_at is null)`,
					after ? gt(entities.id, after) : undefined,
					sql`(${mentioned} or ${related})`
				)
			)
			.orderBy(asc(entities.id))
			.limit(51);
		return {
			items: rows.slice(0, 50).map((row) => ({
				source: { id: row.id, kind: row.kind as EntityKind, title: row.title },
				kinds: [
					...(row.mentioned ? ['note_reference' as const] : []),
					...(row.related ? ['related' as const] : [])
				],
				snippet: row.mentioned && row.body ? noteSnippet(row.body, 240, targetId) : ''
			})),
			nextAfter: rows.length > 50 ? rows[49].id : null
		};
	});
}
