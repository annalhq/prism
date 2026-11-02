import { personaProjection } from './personas.js';
import { and, eq, inArray } from 'drizzle-orm';
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
	return entityShape(
		entity,
		tags.map((tag) => tag.id)
	);
}

// Shapes shared by the single and batched projections, so both produce exactly the same rows.
type EntityRow = typeof entities.$inferSelect;
type BookmarkRow = typeof bookmarks.$inferSelect;
function entityShape(entity: EntityRow, tagIds: string[]): EntityProjection {
	return {
		id: entity.id,
		kind: entity.kind,
		tagIds,
		revision: String(entity.revision) as Revision,
		lastSeq: String(entity.lastSeq) as Sequence,
		deletedAt: entity.deletedAt?.toISOString() ?? null,
		purgedAt: null,
		createdAt: entity.createdAt.toISOString(),
		updatedAt: entity.updatedAt.toISOString()
	};
}
function bookmarkShape(b: BookmarkRow, e: EntityRow, tagIds: string[]): BookmarkProjection {
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
		tagIds,
		deletedAt: e.deletedAt?.toISOString() ?? null,
		revision: String(e.revision) as Revision,
		lastSeq: String(e.lastSeq) as Sequence,
		createdAt: e.createdAt.toISOString(),
		updatedAt: e.updatedAt.toISOString()
	};
}

/** Tag ids per entity, in tag order: one query for a whole page instead of one per row. */
async function tagsFor(tx: Transaction, vaultId: string, ids: string[]) {
	const byEntity = new Map<string, string[]>(ids.map((id) => [id, []]));
	if (!ids.length) return byEntity;
	const rows = await tx
		.select({ entityId: entityTags.entityId, tagId: entityTags.tagId })
		.from(entityTags)
		.where(and(eq(entityTags.vaultId, vaultId), inArray(entityTags.entityId, ids)))
		.orderBy(entityTags.entityId, entityTags.tagId);
	for (const row of rows) byEntity.get(row.entityId)?.push(row.tagId);
	return byEntity;
}

/** Many entities at once, keyed by id (sync bootstrap pages). Same rows as entityProjection. */
export async function entityProjections(
	tx: Transaction,
	vaultId: string,
	ids: string[]
): Promise<Map<string, EntityProjection>> {
	const result = new Map<string, EntityProjection>();
	if (!ids.length) return result;
	const [rows, tags] = await Promise.all([
		tx
			.select()
			.from(entities)
			.where(and(eq(entities.vaultId, vaultId), inArray(entities.id, ids))),
		tagsFor(tx, vaultId, ids)
	]);
	for (const entity of rows) {
		if (entity.purgedAt) continue;
		result.set(entity.id, entityShape(entity, tags.get(entity.id) ?? []));
	}
	if (result.size !== ids.length) throw new Error('Entity projection invariant failed.');
	return result;
}

/** Many bookmarks at once, keyed by id. Same rows as bookmarkProjection. */
export async function bookmarkProjections(
	tx: Transaction,
	vaultId: string,
	ids: string[]
): Promise<Map<string, BookmarkProjection>> {
	const result = new Map<string, BookmarkProjection>();
	if (!ids.length) return result;
	const [rows, tags] = await Promise.all([
		tx
			.select({ bookmark: bookmarks, entity: entities })
			.from(bookmarks)
			.innerJoin(
				entities,
				and(eq(entities.vaultId, bookmarks.vaultId), eq(entities.id, bookmarks.id))
			)
			.where(and(eq(bookmarks.vaultId, vaultId), inArray(bookmarks.id, ids))),
		tagsFor(tx, vaultId, ids)
	]);
	for (const row of rows) {
		if (row.entity.purgedAt) continue;
		result.set(
			row.bookmark.id,
			bookmarkShape(row.bookmark, row.entity, tags.get(row.bookmark.id) ?? [])
		);
	}
	if (result.size !== ids.length) throw new Error('Bookmark projection invariant failed.');
	return result;
}

/** Many people at once, keyed by id. Same rows as personProjection. */
export async function personProjections(
	tx: Transaction,
	vaultId: string,
	ids: string[]
): Promise<Map<string, PersonProjection>> {
	const result = new Map<string, PersonProjection>();
	if (!ids.length) return result;
	const [shapes, rows] = await Promise.all([
		entityProjections(tx, vaultId, ids),
		tx
			.select({
				id: people.id,
				displayName: people.displayName,
				bio: people.bio,
				website: people.website
			})
			.from(people)
			.where(and(eq(people.vaultId, vaultId), inArray(people.id, ids)))
	]);
	for (const { id, ...person } of rows) {
		const entity = shapes.get(id);
		if (!entity || entity.kind !== 'person') throw new Error('Person projection invariant failed.');
		result.set(id, { ...entity, ...person, kind: 'person' });
	}
	if (result.size !== ids.length) throw new Error('Person projection invariant failed.');
	return result;
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
	return bookmarkShape(
		row.bookmark,
		row.entity,
		tags.map((t) => t.id)
	);
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
			website: people.website
		})
		.from(people)
		.where(and(eq(people.vaultId, vaultId), eq(people.id, id)));
	if (!person || entity.kind !== 'person') throw new Error('Person projection invariant failed.');
	return { ...entity, ...person, kind: 'person' };
}
