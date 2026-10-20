import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Revision, Sequence } from '#lib/domain/contracts.js';
import { normalizeOrganizationName } from '#lib/domain/organization.js';
import type {
	PersonaCommand,
	PersonaChange,
	PersonaProjection,
	PersonaMemberProjection
} from '#lib/domain/personas.js';
import type { Transaction } from '../db/connection.js';
import { entities, personas, personaMembers } from '../db/schema.js';
import { requireEntity, requireTargetKind } from './entities.js';
import { entityProjection } from './projections.js';
import { beginPersonaPurge } from './persona-cleanup.js';
import { reject } from './rejections.js';

export async function personaProjection(
	tx: Transaction,
	vaultId: string,
	id: string
): Promise<PersonaProjection> {
	const entity = await entityProjection(tx, vaultId, id);
	const [persona] = await tx
		.select({ name: personas.name, description: personas.description })
		.from(personas)
		.where(and(eq(personas.vaultId, vaultId), eq(personas.id, id)));
	if (!persona || entity.kind !== 'persona')
		throw new Error('Persona projection invariant failed.');
	return { ...entity, ...persona, kind: 'persona' };
}
export function personaMemberProjection(
	row: typeof personaMembers.$inferSelect
): PersonaMemberProjection {
	if (row.memberKind === 'persona') throw new Error('Persona nesting invariant failed.');
	return {
		personaId: row.personaId,
		member: { kind: row.memberKind, id: row.memberId },
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
async function assertAvailableName(
	tx: Transaction,
	vaultId: string,
	id: string,
	normalizedName: string
): Promise<void> {
	const [duplicate] = await tx
		.select({ id: entities.id })
		.from(entities)
		.where(
			and(
				eq(entities.vaultId, vaultId),
				eq(entities.kind, 'persona'),
				eq(entities.personaName, normalizedName),
				isNull(entities.deletedAt),
				ne(entities.id, id)
			)
		)
		.limit(1);
	if (duplicate)
		reject('duplicate_name', 'An active persona already uses this name.', {
			id,
			existingId: duplicate.id
		});
}
export async function applyPersonaCommand(
	tx: Transaction,
	vaultId: string,
	command: PersonaCommand,
	seq: bigint,
	now: Date
): Promise<PersonaChange[]> {
	if ('personaId' in command) {
		const adding = command.type === 'persona-member.add';
		const persona = await requireEntity(tx, vaultId, command.personaId, adding);
		const member = await requireEntity(tx, vaultId, command.member.id, adding);
		if (persona.kind !== 'persona' || member.kind === 'persona')
			reject(
				'invalid_reference',
				'Membership requires a persona and a content or person member in this vault.'
			);
		requireTargetKind(member, command.member);
		if (persona.purgedAt || member.purgedAt)
			reject('purged', 'Permanently removed entities cannot change membership.');
		const identity = and(
			eq(personaMembers.vaultId, vaultId),
			eq(personaMembers.personaId, persona.id),
			eq(personaMembers.memberId, member.id)
		);
		const [current] = await tx.select().from(personaMembers).where(identity);
		const [saved] = current
			? await tx
					.update(personaMembers)
					.set({
						deletedAt: adding ? null : now,
						revision: current.revision + 1n,
						lastSeq: seq,
						updatedAt: now
					})
					.where(identity)
					.returning()
			: await tx
					.insert(personaMembers)
					.values({
						vaultId,
						personaId: persona.id,
						memberId: member.id,
						memberKind: command.member.kind,
						deletedAt: adding ? null : now,
						revision: 1n,
						lastSeq: seq,
						createdAt: now,
						updatedAt: now
					})
					.returning();
		return [{ type: 'persona-member.upsert', membership: personaMemberProjection(saved) }];
	}
	const identity = and(eq(entities.vaultId, vaultId), eq(entities.id, command.id));
	if (command.type === 'persona.create') {
		const [existing] = await tx.select({ id: entities.id }).from(entities).where(identity);
		if (existing) reject('id_exists', 'This entity ID is already reserved.', { id: command.id });
		const name = normalizeOrganizationName(command.name);
		await assertAvailableName(tx, vaultId, command.id, name.normalizedName);
		await tx.insert(entities).values({
			vaultId,
			id: command.id,
			kind: 'persona',
			personaName: name.normalizedName,
			revision: 1n,
			lastSeq: seq,
			createdAt: now,
			updatedAt: now
		});
		await tx
			.insert(personas)
			.values({ vaultId, id: command.id, name: name.name, description: command.description ?? '' });
		return [{ type: 'persona.upsert', persona: await personaProjection(tx, vaultId, command.id) }];
	}
	const entity = await requireEntity(tx, vaultId, command.id);
	if (entity.kind !== 'persona') reject('not_found', 'Persona was not found.', { id: command.id });
	if (entity.purgedAt)
		reject('purged', 'This persona was permanently removed.', { id: command.id });
	if (String(entity.revision) !== command.expectedRevision)
		reject(
			'revision_conflict',
			'This persona changed. Review the current context before retrying.',
			{ id: command.id, currentRevision: String(entity.revision) as Revision }
		);
	if (command.type === 'persona.restore' || command.type === 'persona.purge') {
		if (!entity.deletedAt)
			reject('not_in_trash', 'Move the persona to trash before restoring or purging it.', {
				id: command.id
			});
	} else if (entity.deletedAt)
		reject('in_trash', 'Restore this persona before editing it.', { id: command.id });
	const name =
		command.type === 'persona.update' && command.patch.name !== undefined
			? normalizeOrganizationName(command.patch.name)
			: undefined;
	if (name || command.type === 'persona.restore')
		await assertAvailableName(tx, vaultId, command.id, name?.normalizedName ?? entity.personaName!);
	const revision = entity.revision + 1n;
	await tx
		.update(entities)
		.set({
			revision,
			lastSeq: seq,
			updatedAt: now,
			deletedAt:
				command.type === 'persona.trash'
					? now
					: command.type === 'persona.restore'
						? null
						: entity.deletedAt,
			...(name ? { personaName: name.normalizedName } : {}),
			...(command.type === 'persona.purge' ? { purgedAt: now, personaName: null } : {})
		})
		.where(identity);
	if (command.type === 'persona.purge') {
		await beginPersonaPurge(tx, vaultId, command.id, now);
		return [
			{
				type: 'persona.purge',
				tombstone: {
					id: command.id,
					kind: 'persona',
					revision: String(revision) as Revision,
					lastSeq: String(seq) as Sequence,
					deletedAt: entity.deletedAt!.toISOString(),
					purgedAt: now.toISOString()
				}
			}
		];
	}
	if (command.type === 'persona.update')
		await tx
			.update(personas)
			.set({ ...command.patch, ...(name ? { name: name.name } : {}) })
			.where(and(eq(personas.vaultId, vaultId), eq(personas.id, command.id)));
	return [{ type: 'persona.upsert', persona: await personaProjection(tx, vaultId, command.id) }];
}
