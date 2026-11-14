import { DATABASE_URL, LIBRARY_PUBLIC_VIEW, OWNER_SUBJECT } from '$app/env/private';
import { and, eq, isNull } from 'drizzle-orm';
import { sortByPosition } from '#lib/domain/organization.js';
import type { PublicSnapshot } from '#lib/domain/public-view.js';
import { database } from '../db/connection.js';
import {
	bookmarks,
	contentPeople,
	entities,
	entityTags,
	notes,
	people,
	tagFolders,
	tags,
	vaults
} from '../db/schema.js';

export function publicViewEnabled(): boolean {
	return LIBRARY_PUBLIC_VIEW === 'enabled' && !!DATABASE_URL && !!OWNER_SUBJECT;
}

// One snapshot per vault change: the library is rebuilt only after the owner edits something.
let cached: { key: string; snapshot: PublicSnapshot } | undefined;

/**
 * A read-only copy of the owner's live library for anonymous visitors. Only presentation
 * fields leave the server: trash, purged rows, activity, drafts, revisions and sync state never do.
 * Private tags never leave either, nor does anything carrying one (with its notes and links).
 */
export async function publicSnapshot(): Promise<PublicSnapshot | null> {
	if (!publicViewEnabled()) return null;
	const db = database();
	const [vault] = await db
		.select({ id: vaults.id, changeSeq: vaults.changeSeq, syncEpoch: vaults.syncEpoch })
		.from(vaults)
		.where(eq(vaults.ownerSubject, OWNER_SUBJECT!))
		.limit(1);
	if (!vault) return null;
	const key = `${vault.id}:${vault.syncEpoch}:${vault.changeSeq}`;
	if (cached?.key === key) return cached.snapshot;
	const snapshot = await db.transaction(
		async (tx) => {
			const live = and(
				eq(entities.vaultId, vault.id),
				isNull(entities.deletedAt),
				isNull(entities.purgedAt)
			);
			const bookmarkRows = await tx
				.select({
					bookmark: bookmarks,
					createdAt: entities.createdAt,
					updatedAt: entities.updatedAt
				})
				.from(bookmarks)
				.innerJoin(
					entities,
					and(eq(entities.vaultId, bookmarks.vaultId), eq(entities.id, bookmarks.id))
				)
				.where(live);
			const personRows = await tx
				.select({ person: people, createdAt: entities.createdAt, updatedAt: entities.updatedAt })
				.from(people)
				.innerJoin(entities, and(eq(entities.vaultId, people.vaultId), eq(entities.id, people.id)))
				.where(live);
			const tagRows = await tx
				.select({
					id: tags.id,
					name: tags.name,
					position: tags.position,
					isPrivate: tags.isPrivate,
					folderId: tags.folderId
				})
				.from(tags)
				.where(and(eq(tags.vaultId, vault.id), isNull(tags.deletedAt), isNull(tags.purgedAt)));
			const folderRows = await tx
				.select({ id: tagFolders.id, name: tagFolders.name, position: tagFolders.position })
				.from(tagFolders)
				.where(and(eq(tagFolders.vaultId, vault.id), isNull(tagFolders.deletedAt)));
			const tagLinks = await tx
				.select({ entityId: entityTags.entityId, tagId: entityTags.tagId })
				.from(entityTags)
				.where(eq(entityTags.vaultId, vault.id))
				.orderBy(entityTags.tagId);
			const relationRows = await tx
				.select({
					bookmarkId: contentPeople.bookmarkId,
					personId: contentPeople.personId,
					role: contentPeople.role
				})
				.from(contentPeople)
				.where(
					and(
						eq(contentPeople.vaultId, vault.id),
						isNull(contentPeople.deletedAt),
						isNull(contentPeople.purgedAt)
					)
				);
			const noteRows = await tx
				.select({ entityId: notes.entityId, bodyMarkdown: notes.bodyMarkdown })
				.from(notes)
				.where(eq(notes.vaultId, vault.id));

			const liveTags = new Set(tagRows.map((t) => t.id));
			const privateTags = new Set(tagRows.filter((t) => t.isPrivate).map((t) => t.id));
			const tagsOf = new Map<string, string[]>();
			// Entities carrying any private tag are withheld entirely.
			const hidden = new Set<string>();
			for (const link of tagLinks) {
				if (privateTags.has(link.tagId)) hidden.add(link.entityId);
				if (!liveTags.has(link.tagId)) continue;
				const list = tagsOf.get(link.entityId) ?? [];
				list.push(link.tagId);
				tagsOf.set(link.entityId, list);
			}
			const publicBookmarks = bookmarkRows.filter((r) => !hidden.has(r.bookmark.id));
			const publicPeople = personRows.filter((r) => !hidden.has(r.person.id));
			const bookmarkIds = new Set(publicBookmarks.map((r) => r.bookmark.id));
			const publicTags = sortByPosition(tagRows.filter((t) => !t.isPrivate));
			const publicFolders = new Set(publicTags.map((t) => t.folderId));
			const personIds = new Set(publicPeople.map((r) => r.person.id));
			return {
				bookmarks: publicBookmarks.map(({ bookmark: b, createdAt, updatedAt }) => ({
					id: b.id,
					kind: b.kind,
					title: b.title,
					description: b.description,
					url: b.url,
					domain: b.domain,
					readingStatus: b.readingStatus,
					isPinned: b.isPinned,
					archivedAt: b.archivedAt?.toISOString() ?? null,
					collectionId: null,
					tagIds: tagsOf.get(b.id) ?? [],
					deletedAt: null,
					purgedAt: null,
					createdAt: createdAt.toISOString(),
					updatedAt: updatedAt.toISOString()
				})),
				people: publicPeople.map(({ person: p, createdAt, updatedAt }) => ({
					id: p.id,
					kind: 'person',
					displayName: p.displayName,
					bio: p.bio,
					website: p.website,
					tagIds: tagsOf.get(p.id) ?? [],
					deletedAt: null,
					purgedAt: null,
					createdAt: createdAt.toISOString(),
					updatedAt: updatedAt.toISOString()
				})),
				tags: publicTags.map((t) => ({
					id: t.id,
					name: t.name,
					position: t.position,
					folderId: t.folderId,
					deletedAt: null
				})),
				// Only folders holding a public tag: an empty or all-private folder stays unseen.
				folders: sortByPosition(folderRows.filter((f) => publicFolders.has(f.id))).map((f) => ({
					id: f.id,
					name: f.name,
					position: f.position,
					deletedAt: null
				})),
				relationships: relationRows
					.filter((r) => bookmarkIds.has(r.bookmarkId) && personIds.has(r.personId))
					.map((r) => ({ ...r, deletedAt: null })),
				notes: noteRows
					.filter((n) => bookmarkIds.has(n.entityId) && n.bodyMarkdown.trim())
					.map((n) => ({ entityId: n.entityId, bodyMarkdown: n.bodyMarkdown }))
			} satisfies PublicSnapshot;
		},
		{ isolationLevel: 'repeatable read', accessMode: 'read only' }
	);
	cached = { key, snapshot };
	return snapshot;
}
