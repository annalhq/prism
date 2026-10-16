import { and, eq } from 'drizzle-orm';
import type { Change, Revision, Sequence } from '#lib/domain/contracts.js';
import {
	shouldPreserveManual,
	type ContentPersonCommand,
	type ContentPersonProjection
} from '#lib/domain/relationships.js';
import type { Transaction } from '../db/connection.js';
import { contentPeople } from '../db/schema.js';
import { requireEntity } from './entities.js';
import { reject } from './rejections.js';

export function contentPersonProjection(
	row: typeof contentPeople.$inferSelect
): ContentPersonProjection {
	return {
		bookmarkId: row.bookmarkId,
		personId: row.personId,
		role: row.role,
		provenance: row.provenance,
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
export async function changeContentPerson(
	tx: Transaction,
	vaultId: string,
	command: ContentPersonCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const adding = command.type === 'content-person.add';
	const bookmark = await requireEntity(tx, vaultId, command.bookmarkId, adding);
	const person = await requireEntity(tx, vaultId, command.personId, adding);
	if (bookmark.kind !== 'bookmark' || person.kind !== 'person')
		reject(
			'invalid_reference',
			'Content-person associations require a bookmark and a person in this vault.'
		);
	if (bookmark.purgedAt)
		reject('purged', 'This bookmark was permanently removed.', { id: bookmark.id });
	if (adding && person.purgedAt)
		reject('purged', 'A purged person cannot be newly assigned.', { id: person.id });
	const identity = and(
		eq(contentPeople.vaultId, vaultId),
		eq(contentPeople.bookmarkId, bookmark.id),
		eq(contentPeople.personId, person.id),
		eq(contentPeople.role, command.role)
	);
	const [current] = await tx.select().from(contentPeople).where(identity);
	if (!current && !adding && person.purgedAt) return [];
	// Confirmed capture may add missing roles, but never replace a manual decision,
	// including its deletion tombstone. Re-adding manually is always explicit.
	if (current && adding && shouldPreserveManual(current.provenance, command.provenance))
		return [{ type: 'content-person.upsert', relationship: contentPersonProjection(current) }];
	const [saved] = current
		? await tx
				.update(contentPeople)
				.set({
					// Removal is a manual decision even when capture created the row.
					provenance: adding ? command.provenance : 'manual',
					deletedAt: adding ? null : now,
					revision: current.revision + 1n,
					lastSeq: seq,
					updatedAt: now
				})
				.where(identity)
				.returning()
		: await tx
				.insert(contentPeople)
				.values({
					vaultId,
					bookmarkId: bookmark.id,
					personId: person.id,
					role: command.role,
					provenance: command.type === 'content-person.add' ? command.provenance : 'manual',
					deletedAt: adding ? null : now,
					revision: 1n,
					lastSeq: seq,
					createdAt: now,
					updatedAt: now
				})
				.returning();
	return [{ type: 'content-person.upsert', relationship: contentPersonProjection(saved) }];
}
