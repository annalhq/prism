import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import {
	contentPeople,
	entities,
	entityLinks,
	entityTags,
	maintenanceJobs,
	noteRevisions,
	notes,
	people,
	personaMembers,
	personAvatars,
	personIdentities,
	vaults
} from '../db/schema.js';
import { ApiError } from '../http.js';

// One pass removes at most 100 relationship rows, regardless of profile degree.
// The purge marker/registry lifecycle already hides every owned or assigned row.
export async function cleanupPurgedPerson(
	tx: Transaction,
	vaultId: string,
	id: string
): Promise<boolean> {
	const [entity] = await tx
		.select({ purgedAt: entities.purgedAt, kind: entities.kind })
		.from(entities)
		.where(and(eq(entities.vaultId, vaultId), eq(entities.id, id)));
	if (!entity?.purgedAt || entity.kind !== 'person')
		throw new Error('Person cleanup requires a purged person.');
	let remaining = 100;
	// Active identities first: the 50-active-identity cap releases all uniqueness keys
	// in the initial purge pass, even when removed identity history is large.
	const identities = await tx
		.select({ id: personIdentities.id })
		.from(personIdentities)
		.where(and(eq(personIdentities.vaultId, vaultId), eq(personIdentities.personId, id)))
		.orderBy(sql`${personIdentities.deletedAt} asc nulls first`, personIdentities.id)
		.limit(remaining);
	if (identities.length)
		await tx.delete(personIdentities).where(
			and(
				eq(personIdentities.vaultId, vaultId),
				eq(personIdentities.personId, id),
				inArray(
					personIdentities.id,
					identities.map((row) => row.id)
				)
			)
		);
	remaining -= identities.length;
	if (!remaining) return false;
	const roles = await tx
		.select({ bookmarkId: contentPeople.bookmarkId, role: contentPeople.role })
		.from(contentPeople)
		.where(and(eq(contentPeople.vaultId, vaultId), eq(contentPeople.personId, id)))
		.orderBy(contentPeople.bookmarkId, contentPeople.role)
		.limit(remaining);
	if (roles.length)
		await tx
			.delete(contentPeople)
			.where(
				and(
					eq(contentPeople.vaultId, vaultId),
					eq(contentPeople.personId, id),
					or(
						...roles.map((row) =>
							and(eq(contentPeople.bookmarkId, row.bookmarkId), eq(contentPeople.role, row.role))
						)
					)
				)
			);
	remaining -= roles.length;
	if (!remaining) return false;
	const memberships = await tx
		.select({ personaId: personaMembers.personaId })
		.from(personaMembers)
		.where(and(eq(personaMembers.vaultId, vaultId), eq(personaMembers.memberId, id)))
		.orderBy(personaMembers.personaId)
		.limit(remaining);
	if (memberships.length)
		await tx.delete(personaMembers).where(
			and(
				eq(personaMembers.vaultId, vaultId),
				eq(personaMembers.memberId, id),
				inArray(
					personaMembers.personaId,
					memberships.map((row) => row.personaId)
				)
			)
		);
	remaining -= memberships.length;
	if (!remaining) return false;
	const links = await tx
		.select({ targetId: entityLinks.targetId, kind: entityLinks.kind })
		.from(entityLinks)
		.where(and(eq(entityLinks.vaultId, vaultId), eq(entityLinks.sourceId, id)))
		.orderBy(entityLinks.targetId, entityLinks.kind)
		.limit(remaining);
	if (links.length)
		await tx
			.delete(entityLinks)
			.where(
				and(
					eq(entityLinks.vaultId, vaultId),
					eq(entityLinks.sourceId, id),
					or(
						...links.map((row) =>
							and(eq(entityLinks.targetId, row.targetId), eq(entityLinks.kind, row.kind))
						)
					)
				)
			);
	remaining -= links.length;
	if (!remaining) return false;
	// Their stored X photo goes with them: queue the object for the media worker, drop the row.
	await tx.execute(sql`
		INSERT INTO maintenance_jobs (vault_id, kind, deduplication_key, payload)
		SELECT vault_id, 'media.delete', 'avatar:' || object_key, jsonb_build_object('objectKey', object_key)
		FROM person_avatars
		WHERE vault_id = ${vaultId}::uuid AND person_id = ${id}::uuid AND object_key IS NOT NULL
		ON CONFLICT (vault_id, deduplication_key) DO NOTHING
	`);
	await tx
		.delete(personAvatars)
		.where(and(eq(personAvatars.vaultId, vaultId), eq(personAvatars.personId, id)));
	await tx.delete(people).where(and(eq(people.vaultId, vaultId), eq(people.id, id)));
	return true;
}
export async function beginPersonPurge(
	tx: Transaction,
	vaultId: string,
	id: string,
	now: Date
): Promise<void> {
	// A scrubbed FK anchor survives only while bounded cleanup still has children.
	await tx
		.update(people)
		.set({ displayName: 'Deleted person', bio: '', website: null })
		.where(and(eq(people.vaultId, vaultId), eq(people.id, id)));
	await tx
		.delete(noteRevisions)
		.where(and(eq(noteRevisions.vaultId, vaultId), eq(noteRevisions.entityId, id)));
	await tx.delete(notes).where(and(eq(notes.vaultId, vaultId), eq(notes.entityId, id)));
	await tx
		.delete(entityTags)
		.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.entityId, id)));
	if (!(await cleanupPurgedPerson(tx, vaultId, id))) {
		await tx
			.insert(maintenanceJobs)
			.values({
				vaultId,
				kind: 'person.cleanup',
				deduplicationKey: `purge-person:${id}`,
				payload: { personId: id },
				runAfter: now
			})
			.onConflictDoNothing();
	}
}
// Task 16's scheduler can repeatedly call this resumable, owner-checked handler.
// Cleanup emits no child frames: the committed purge marker already removes them
// from replicas. Restarts are safe and no other vault can be cleaned by this call.
export async function processPersonCleanup(
	owner: OwnerContext,
	id: string
): Promise<{ complete: boolean }> {
	return inTransaction(async (tx) => {
		const [vault] = await tx
			.select({ id: vaults.id })
			.from(vaults)
			.where(and(eq(vaults.id, owner.vaultId), eq(vaults.ownerSubject, owner.subject)))
			.for('update');
		if (!vault)
			throw new ApiError(403, 'vault_denied', 'This library is not available to this owner.');
		const complete = await cleanupPurgedPerson(tx, owner.vaultId, id);
		await tx
			.update(maintenanceJobs)
			.set({ state: complete ? 'done' : 'pending', leaseUntil: null })
			.where(
				and(
					eq(maintenanceJobs.vaultId, owner.vaultId),
					eq(maintenanceJobs.kind, 'person.cleanup'),
					eq(maintenanceJobs.deduplicationKey, `purge-person:${id}`)
				)
			);
		return { complete };
	});
}
