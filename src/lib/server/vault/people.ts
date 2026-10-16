import { and, eq } from 'drizzle-orm';
import type { Change, Revision, Sequence } from '#lib/domain/contracts.js';
import type { PersonCommand } from '#lib/domain/people.js';
import type { Transaction } from '../db/connection.js';
import { entities, people } from '../db/schema.js';
import { requireEntity } from './entities.js';
import { personProjection } from './projections.js';
import { beginPersonPurge } from './person-cleanup.js';
import { reject } from './rejections.js';

export async function changePerson(
	tx: Transaction,
	vaultId: string,
	command: PersonCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const identity = and(eq(entities.vaultId, vaultId), eq(entities.id, command.id));
	if (command.type === 'person.create') {
		const [existing] = await tx.select({ id: entities.id }).from(entities).where(identity);
		if (existing) reject('id_exists', 'This entity ID is already reserved.', { id: command.id });
		await tx.insert(entities).values({
			vaultId,
			id: command.id,
			kind: 'person',
			revision: 1n,
			lastSeq: seq,
			createdAt: now,
			updatedAt: now
		});
		await tx.insert(people).values({
			vaultId,
			id: command.id,
			displayName: command.displayName,
			bio: command.bio ?? '',
			website: command.website ?? null
		});
		return [{ type: 'person.upsert', person: await personProjection(tx, vaultId, command.id) }];
	}
	const entity = await requireEntity(tx, vaultId, command.id);
	if (entity.kind !== 'person') reject('not_found', 'Person was not found.', { id: command.id });
	if (entity.purgedAt) reject('purged', 'This person was permanently removed.', { id: command.id });
	if (String(entity.revision) !== command.expectedRevision)
		reject(
			'revision_conflict',
			'This person changed. Review the current profile before retrying.',
			{ id: command.id, currentRevision: String(entity.revision) as Revision }
		);
	if (command.type === 'person.restore' || command.type === 'person.purge') {
		if (!entity.deletedAt)
			reject('not_in_trash', 'Move the person to trash before restoring or purging it.', {
				id: command.id
			});
	} else if (entity.deletedAt)
		reject('in_trash', 'Restore this person before editing it.', { id: command.id });
	const revision = entity.revision + 1n;
	await tx
		.update(entities)
		.set({
			revision,
			lastSeq: seq,
			updatedAt: now,
			deletedAt:
				command.type === 'person.trash'
					? now
					: command.type === 'person.restore'
						? null
						: entity.deletedAt,
			...(command.type === 'person.purge' ? { purgedAt: now } : {})
		})
		.where(identity);
	if (command.type === 'person.purge') {
		await beginPersonPurge(tx, vaultId, command.id, now);
		return [
			{
				type: 'person.purge',
				tombstone: {
					id: command.id,
					kind: 'person',
					revision: String(revision) as Revision,
					lastSeq: String(seq) as Sequence,
					deletedAt: entity.deletedAt!.toISOString(),
					purgedAt: now.toISOString()
				}
			}
		];
	}
	if (command.type === 'person.update')
		await tx
			.update(people)
			.set(command.patch)
			.where(and(eq(people.vaultId, vaultId), eq(people.id, command.id)));
	return [{ type: 'person.upsert', person: await personProjection(tx, vaultId, command.id) }];
}
