import { and, eq } from 'drizzle-orm';
import type { Change, Revision, Sequence } from '#lib/domain/contracts.js';
import type { Transaction } from '../db/connection.js';
import { bookmarkActivity } from '../db/schema.js';
import { requireEntity } from './entities.js';
import { reject } from './rejections.js';

export async function recordOpen(
	tx: Transaction,
	vaultId: string,
	id: string,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const source = await requireEntity(tx, vaultId, id, true);
	if (source.kind !== 'bookmark')
		reject('invalid_command', 'Open activity applies only to bookmarks.', { id });
	const identity = and(eq(bookmarkActivity.vaultId, vaultId), eq(bookmarkActivity.bookmarkId, id));
	const [current] = await tx.select().from(bookmarkActivity).where(identity);
	const [saved] = current
		? await tx
				.update(bookmarkActivity)
				.set({
					lastOpenedAt: now,
					openCount: current.openCount + 1n,
					revision: current.revision + 1n,
					lastSeq: seq,
					updatedAt: now
				})
				.where(identity)
				.returning()
		: await tx
				.insert(bookmarkActivity)
				.values({
					vaultId,
					bookmarkId: id,
					lastOpenedAt: now,
					openCount: 1n,
					revision: 1n,
					lastSeq: seq,
					createdAt: now,
					updatedAt: now
				})
				.returning();
	return [
		{
			type: 'activity.upsert',
			activity: {
				bookmarkId: id,
				lastOpenedAt: saved.lastOpenedAt.toISOString(),
				openCount: String(saved.openCount) as `${bigint}`,
				revision: String(saved.revision) as Revision,
				lastSeq: String(saved.lastSeq) as Sequence,
				createdAt: saved.createdAt.toISOString(),
				updatedAt: saved.updatedAt.toISOString()
			}
		}
	];
}
