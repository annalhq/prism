import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../db/connection.js';
import {
	attachments,
	bookmarkActivity,
	bookmarks,
	contentPeople,
	entityLinks,
	entityTags,
	noteRevisions,
	notes,
	personaMembers,
	uploadIntents
} from '../db/schema.js';

export async function purgeBookmark(tx: Transaction, vaultId: string, id: string): Promise<void> {
	// Copy storage ownership into durable jobs before deleting it. INSERT SELECT avoids
	// transferring every attachment through the app or putting media keys in sync frames.
	await tx.execute(sql`
		INSERT INTO maintenance_jobs (vault_id, kind, deduplication_key, payload)
		SELECT vault_id, 'media.delete', 'purge-attachment:' || id::text,
			jsonb_build_object('objectKey', object_key, 'objectVersion', object_version,
				'thumbnailKey', thumbnail_key, 'thumbnailVersion', thumbnail_version)
		FROM attachments WHERE vault_id = ${vaultId}::uuid AND bookmark_id = ${id}::uuid
		ON CONFLICT (vault_id, deduplication_key) DO NOTHING
	`);
	// A still-valid signed upload can finish after purge. Cleanup runs only after expiry;
	// the future media worker must remove all versions for this intent's exclusive key.
	await tx.execute(sql`
		INSERT INTO maintenance_jobs (vault_id, kind, deduplication_key, payload, run_after)
		SELECT vault_id, 'media.delete-upload', 'purge-upload:' || id::text,
			jsonb_build_object('objectKey', object_key, 'expiresAt', expires_at),
			GREATEST(now(), expires_at + interval '1 hour')
		FROM upload_intents WHERE vault_id = ${vaultId}::uuid AND bookmark_id = ${id}::uuid
		ON CONFLICT (vault_id, deduplication_key) DO NOTHING
	`);
	await tx
		.delete(noteRevisions)
		.where(and(eq(noteRevisions.vaultId, vaultId), eq(noteRevisions.entityId, id)));
	await tx.delete(notes).where(and(eq(notes.vaultId, vaultId), eq(notes.entityId, id)));
	await tx
		.delete(entityLinks)
		.where(and(eq(entityLinks.vaultId, vaultId), eq(entityLinks.sourceId, id)));
	await tx
		.delete(entityTags)
		.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.entityId, id)));
	await tx
		.delete(contentPeople)
		.where(and(eq(contentPeople.vaultId, vaultId), eq(contentPeople.bookmarkId, id)));
	await tx
		.delete(personaMembers)
		.where(and(eq(personaMembers.vaultId, vaultId), eq(personaMembers.memberId, id)));
	await tx
		.delete(bookmarkActivity)
		.where(and(eq(bookmarkActivity.vaultId, vaultId), eq(bookmarkActivity.bookmarkId, id)));
	await tx
		.delete(attachments)
		.where(and(eq(attachments.vaultId, vaultId), eq(attachments.bookmarkId, id)));
	await tx
		.delete(uploadIntents)
		.where(and(eq(uploadIntents.vaultId, vaultId), eq(uploadIntents.bookmarkId, id)));
	await tx.delete(bookmarks).where(and(eq(bookmarks.vaultId, vaultId), eq(bookmarks.id, id)));
}
