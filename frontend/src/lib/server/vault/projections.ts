import { personaProjection } from './personas.js';
import { and, eq } from 'drizzle-orm';
import type {
	BookmarkProjection,
	Change,
	EntityProjection,
	Revision,
	Sequence
} from '#lib/domain/contracts.js';
import type { Transaction } from '../db/connection.js';
import type { PersonProjection } from '#lib/domain/people.js';
import { bookmarks, entities, entityTags, people } from '../db/schema.js';

export async function entityProjection(
	tx: Transaction,
	vaultId: string,
	id: string
): Promise<EntityProjection> {
	const [entity] = await tx
		.select()
		.from(entities)
		.where(and(eq(entities.vaultId, vaultId), eq(entities.id, id)));
	if (!entity || entity.purgedAt) throw new Error('Entity projection invariant failed.');
	const tags = await tx
		.select({ id: entityTags.tagId })
		.from(entityTags)
		.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.entityId, id)))
		.orderBy(entityTags.tagId);
	return {
		id,
		kind: entity.kind,
		tagIds: tags.map((tag) => tag.id),
		revision: String(entity.revision) as Revision,
		lastSeq: String(entity.lastSeq) as Sequence,
		deletedAt: entity.deletedAt?.toISOString() ?? null,
		purgedAt: null,
		createdAt: entity.createdAt.toISOString(),
		updatedAt: entity.updatedAt.toISOString()
	};
}
export async function entityMetadataChange(
	tx: Transaction,
	vaultId: string,
	id: string,
	kind: EntityProjection['kind']
): Promise<Change> {
	return kind === 'bookmark'
		? { type: 'bookmark.upsert', bookmark: await bookmarkProjection(tx, vaultId, id) }
		: kind === 'person'
			? { type: 'person.upsert', person: await personProjection(tx, vaultId, id) }
			: { type: 'persona.upsert', persona: await personaProjection(tx, vaultId, id) };
}

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

export async function personProjection(
	tx: Transaction,
	vaultId: string,
	id: string
): Promise<PersonProjection> {
	const entity = await entityProjection(tx, vaultId, id);
	const [person] = await tx
		.select({
			displayName: people.displayName,
			bio: people.bio,
			website: people.website,
			avatarConfig: people.avatarConfig
		})
		.from(people)
		.where(and(eq(people.vaultId, vaultId), eq(people.id, id)));
	if (!person || entity.kind !== 'person') throw new Error('Person projection invariant failed.');
	return { ...entity, ...person, kind: 'person' };
}
