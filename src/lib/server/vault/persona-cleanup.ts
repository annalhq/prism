import { and, eq, inArray, or } from 'drizzle-orm';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import {
	entities,
	entityLinks,
	entityTags,
	maintenanceJobs,
	noteRevisions,
	notes,
	personas,
	personaMembers,
	vaults
} from '../db/schema.js';
import { ApiError } from '../http.js';

// A purge frame hides all owned children immediately. Physical cleanup is bounded,
// resumable, and preserves incoming reference IDs and the minimal registry tombstone.
export async function cleanupPurgedPersona(
	tx: Transaction,
	vaultId: string,
	id: string
): Promise<boolean> {
	const [entity] = await tx
		.select({ kind: entities.kind, purgedAt: entities.purgedAt })
		.from(entities)
		.where(and(eq(entities.vaultId, vaultId), eq(entities.id, id)));
	if (entity?.kind !== 'persona' || !entity.purgedAt)
		throw new Error('Persona cleanup requires a purged persona.');
	let remaining = 100;
	const members = await tx
		.select({ id: personaMembers.memberId })
		.from(personaMembers)
		.where(and(eq(personaMembers.vaultId, vaultId), eq(personaMembers.personaId, id)))
		.orderBy(personaMembers.memberId)
		.limit(remaining);
	if (members.length)
		await tx.delete(personaMembers).where(
			and(
				eq(personaMembers.vaultId, vaultId),
				eq(personaMembers.personaId, id),
				inArray(
					personaMembers.memberId,
					members.map((row) => row.id)
				)
			)
		);
	remaining -= members.length;
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
	const history = await tx
		.select({ revision: noteRevisions.revision })
		.from(noteRevisions)
		.where(and(eq(noteRevisions.vaultId, vaultId), eq(noteRevisions.entityId, id)))
		.orderBy(noteRevisions.revision)
		.limit(remaining);
	if (history.length)
		await tx.delete(noteRevisions).where(
			and(
				eq(noteRevisions.vaultId, vaultId),
				eq(noteRevisions.entityId, id),
				inArray(
					noteRevisions.revision,
					history.map((row) => row.revision)
				)
			)
		);
	remaining -= history.length;
	if (!remaining) return false;
	const tags = await tx
		.select({ id: entityTags.tagId })
		.from(entityTags)
		.where(and(eq(entityTags.vaultId, vaultId), eq(entityTags.entityId, id)))
		.orderBy(entityTags.tagId)
		.limit(remaining);
	if (tags.length)
		await tx.delete(entityTags).where(
			and(
				eq(entityTags.vaultId, vaultId),
				eq(entityTags.entityId, id),
				inArray(
					entityTags.tagId,
					tags.map((row) => row.id)
				)
			)
		);
	remaining -= tags.length;
	if (!remaining) return false;
	await tx.delete(notes).where(and(eq(notes.vaultId, vaultId), eq(notes.entityId, id)));
	await tx.delete(personas).where(and(eq(personas.vaultId, vaultId), eq(personas.id, id)));
	return true;
}
export async function beginPersonaPurge(
	tx: Transaction,
	vaultId: string,
	id: string,
	now: Date
): Promise<void> {
	await tx
		.update(personas)
		.set({ name: 'Deleted persona', description: '' })
		.where(and(eq(personas.vaultId, vaultId), eq(personas.id, id)));
	await tx
		.update(notes)
		.set({ bodyMarkdown: '' })
		.where(and(eq(notes.vaultId, vaultId), eq(notes.entityId, id)));
	if (!(await cleanupPurgedPersona(tx, vaultId, id)))
		await tx
			.insert(maintenanceJobs)
			.values({
				vaultId,
				kind: 'persona.cleanup',
				deduplicationKey: `purge-persona:${id}`,
				payload: { personaId: id },
				runAfter: now
			})
			.onConflictDoNothing();
}
export async function processPersonaCleanup(
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
		const complete = await cleanupPurgedPersona(tx, owner.vaultId, id);
		await tx
			.update(maintenanceJobs)
			.set({ state: complete ? 'done' : 'pending', leaseUntil: null })
			.where(
				and(
					eq(maintenanceJobs.vaultId, owner.vaultId),
					eq(maintenanceJobs.kind, 'persona.cleanup'),
					eq(maintenanceJobs.deduplicationKey, `purge-persona:${id}`)
				)
			);
		return { complete };
	});
}
