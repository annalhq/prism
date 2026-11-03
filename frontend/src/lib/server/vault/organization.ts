import { and, eq, isNull, ne } from 'drizzle-orm';
import {
	MAX_ENTITY_TAGS,
	normalizeOrganizationName,
	type BookmarkOrganization,
	type TagMembershipCommand,
	type TaxonomyCommand
} from '#lib/domain/organization.js';
import type { Change, Revision, Sequence, TaxonomyProjection } from '#lib/domain/contracts.js';
import type { Transaction } from '../db/connection.js';
import { bookmarks, collections, entities, entityTags, tags } from '../db/schema.js';
import { requireEntity } from './entities.js';
import { entityMetadataChange } from './projections.js';
import { reject } from './rejections.js';

export function taxonomyProjection(
	row: typeof tags.$inferSelect | typeof collections.$inferSelect
): TaxonomyProjection {
	return {
		id: row.id,
		name: row.name,
		normalizedName: row.normalizedName,
		...('position' in row ? { position: row.position, isPrivate: row.isPrivate } : {}),
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
export async function changeTaxonomy(
	tx: Transaction,
	vaultId: string,
	command: TaxonomyCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const isTag = command.type.startsWith('tag.');
	const table = isTag ? tags : collections;
	const identity = and(eq(table.vaultId, vaultId), eq(table.id, command.id));
	const [current] = await tx.select().from(table).where(identity);
	const create = command.type === 'tag.create' || command.type === 'collection.create';
	if (create) {
		if (current)
			reject('id_exists', 'This organization ID is already reserved.', { id: command.id });
	} else {
		if (!current) reject('not_found', 'Organization entry was not found.', { id: command.id });
		if (current.deletedAt || current.purgedAt)
			reject('not_found', 'This organization entry was deleted.', { id: command.id });
		if ('expectedRevision' in command && String(current.revision) !== command.expectedRevision)
			reject('revision_conflict', 'This organization entry changed. Review the current version.', {
				id: command.id,
				currentRevision: String(current.revision) as Revision
			});
	}
	if (command.type === 'tag.move' || command.type === 'tag.privacy') {
		const [moved] = await tx
			.update(tags)
			.set({
				...(command.type === 'tag.move'
					? { position: command.position }
					: { isPrivate: command.isPrivate }),
				revision: current!.revision + 1n,
				lastSeq: seq,
				updatedAt: now
			})
			.where(and(eq(tags.vaultId, vaultId), eq(tags.id, command.id)))
			.returning();
		return [{ type: 'tag.upsert', tag: taxonomyProjection(moved) }];
	}
	const deleting = command.type === 'tag.delete' || command.type === 'collection.delete';
	if (deleting) {
		const used = isTag
			? await tx
					.select({ id: entityTags.entityId })
					.from(entityTags)
					.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.tagId, command.id)))
					.limit(1)
			: await tx
					.select({ id: bookmarks.id })
					.from(bookmarks)
					.where(and(eq(bookmarks.vaultId, vaultId), eq(bookmarks.collectionId, command.id)))
					.limit(1);
		if (used.length)
			reject(
				'in_use',
				'Remove memberships or move items in bounded commands before deleting this entry.',
				{ id: command.id }
			);
	}
	const name = 'name' in command ? normalizeOrganizationName(command.name) : undefined;
	if (name) {
		const [duplicate] = await tx
			.select({ id: table.id })
			.from(table)
			.where(
				and(
					eq(table.vaultId, vaultId),
					eq(table.normalizedName, name.normalizedName),
					isNull(table.deletedAt),
					ne(table.id, command.id)
				)
			)
			.limit(1);
		if (duplicate)
			reject('duplicate_name', 'An active entry already uses this name.', {
				id: command.id,
				existingId: duplicate.id
			});
	}
	const [saved] = create
		? await tx
				.insert(table)
				.values({
					vaultId,
					id: command.id,
					...name!,
					revision: 1n,
					lastSeq: seq,
					createdAt: now,
					updatedAt: now
				})
				.returning()
		: await tx
				.update(table)
				.set({
					...name,
					revision: current!.revision + 1n,
					lastSeq: seq,
					updatedAt: now,
					...(deleting ? { deletedAt: now } : {})
				})
				.where(identity)
				.returning();
	const projection = taxonomyProjection(saved);
	return [
		isTag
			? { type: 'tag.upsert', tag: projection }
			: { type: 'collection.upsert', collection: projection }
	];
}

export async function changeTagMembership(
	tx: Transaction,
	vaultId: string,
	command: TagMembershipCommand,
	seq: bigint,
	now: Date,
	bookmarkOnly = false
): Promise<Change[]> {
	const adding = command.type === 'tag.add';
	const source = await requireEntity(tx, vaultId, command.id, adding);
	if (source.purgedAt) reject('purged', 'This entity was permanently removed.', { id: source.id });
	if (bookmarkOnly && source.kind !== 'bookmark')
		reject('invalid_command', 'Bookmark bulk commands cannot modify profile tags.', {
			id: source.id
		});
	const [tag] = await tx
		.select({ id: tags.id, deletedAt: tags.deletedAt, purgedAt: tags.purgedAt })
		.from(tags)
		.where(and(eq(tags.vaultId, vaultId), eq(tags.id, command.tagId)));
	if (!tag || (adding && (tag.deletedAt || tag.purgedAt)))
		reject('not_found', 'An active tag was not found.', { id: command.tagId });
	const membership = and(
		eq(entityTags.vaultId, vaultId),
		eq(entityTags.entityId, source.id),
		eq(entityTags.tagId, command.tagId)
	);
	if (adding) {
		const existing = await tx
			.select({ tagId: entityTags.tagId })
			.from(entityTags)
			.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.entityId, source.id)))
			.limit(MAX_ENTITY_TAGS + 1);
		if (
			!existing.some((item) => item.tagId === command.tagId) &&
			existing.length >= MAX_ENTITY_TAGS
		)
			reject('tag_limit', 'An entity may have at most 50 tags.', { id: source.id });
		await tx
			.insert(entityTags)
			.values({ vaultId, entityId: source.id, tagId: command.tagId })
			.onConflictDoNothing();
	} else await tx.delete(entityTags).where(membership);
	await tx
		.update(entities)
		.set({ revision: source.revision + 1n, lastSeq: seq, updatedAt: now })
		.where(and(eq(entities.vaultId, vaultId), eq(entities.id, source.id)));
	return [await entityMetadataChange(tx, vaultId, source.id, source.kind)];
}

// Called after the command service checks source kind, lifecycle and metadata revision.
export async function organizeBookmark(
	tx: Transaction,
	vaultId: string,
	id: string,
	patch: BookmarkOrganization,
	current: typeof bookmarks.$inferSelect,
	now: Date
): Promise<void> {
	if (patch.collectionId) {
		const [collection] = await tx
			.select({ id: collections.id })
			.from(collections)
			.where(
				and(
					eq(collections.vaultId, vaultId),
					eq(collections.id, patch.collectionId),
					isNull(collections.deletedAt),
					isNull(collections.purgedAt)
				)
			);
		if (!collection)
			reject('not_found', 'An active collection was not found.', { id: patch.collectionId });
	}
	const { isArchived, ...fields } = patch;
	await tx
		.update(bookmarks)
		.set({
			...fields,
			...(isArchived === undefined
				? {}
				: { archivedAt: isArchived ? (current.archivedAt ?? now) : null })
		})
		.where(and(eq(bookmarks.vaultId, vaultId), eq(bookmarks.id, id)));
}
