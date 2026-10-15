import { and, eq } from 'drizzle-orm';
import type { BookmarkProjection, Revision, Sequence } from '#lib/domain/contracts.js';
import type { Transaction } from '../db/connection.js';
import { bookmarks, entities, entityTags } from '../db/schema.js';

export async function bookmarkProjection(
	tx: Transaction,
	vaultId: string,
	id: string
): Promise<BookmarkProjection> {
	const [row] = await tx
		.select({ bookmark: bookmarks, entity: entities })
		.from(bookmarks)
		.innerJoin(
			entities,
			and(eq(entities.vaultId, bookmarks.vaultId), eq(entities.id, bookmarks.id))
		)
		.where(and(eq(bookmarks.vaultId, vaultId), eq(bookmarks.id, id)));
	if (!row || row.entity.purgedAt) throw new Error('Bookmark projection invariant failed.');
	const tags = await tx
		.select({ id: entityTags.tagId })
		.from(entityTags)
		.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.entityId, id)))
		.orderBy(entityTags.tagId);
	const b = row.bookmark,
		e = row.entity;
	return {
		id: b.id,
		kind: b.kind,
		title: b.title,
		description: b.description,
		url: b.url,
		canonicalUrl: b.canonicalUrl,
		domain: b.domain,
		collectionId: b.collectionId,
		readingStatus: b.readingStatus,
		isPinned: b.isPinned,
		archivedAt: b.archivedAt?.toISOString() ?? null,
		tagIds: tags.map((t) => t.id),
		deletedAt: e.deletedAt?.toISOString() ?? null,
		revision: String(e.revision) as Revision,
		lastSeq: String(e.lastSeq) as Sequence,
		createdAt: e.createdAt.toISOString(),
		updatedAt: e.updatedAt.toISOString()
	};
}
