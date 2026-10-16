import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Change, Revision, Sequence } from '#lib/domain/contracts.js';
import {
	MAX_PERSON_IDENTITIES,
	type PersonIdentityCommand,
	type PersonIdentityProjection
} from '#lib/domain/people.js';
import type { Transaction } from '../db/connection.js';
import { personIdentities } from '../db/schema.js';
import { requireEntity } from './entities.js';
import { reject } from './rejections.js';

export function identityProjection(
	row: typeof personIdentities.$inferSelect
): PersonIdentityProjection {
	return {
		id: row.id,
		personId: row.personId,
		platform: row.platform,
		nativeAccountId: row.nativeAccountId,
		profileUrl: row.profileUrl,
		handle: row.handle,
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
export async function changeIdentity(
	tx: Transaction,
	vaultId: string,
	command: PersonIdentityCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const person = await requireEntity(
		tx,
		vaultId,
		command.personId,
		command.type === 'person-identity.add'
	);
	if (person.kind !== 'person')
		reject('not_found', 'Person was not found.', { id: command.personId });
	if (person.purgedAt) reject('purged', 'This person was permanently removed.', { id: person.id });
	const identity = and(eq(personIdentities.vaultId, vaultId), eq(personIdentities.id, command.id));
	const [current] = await tx.select().from(personIdentities).where(identity);
	if (command.type === 'person-identity.remove') {
		if (!current || current.personId !== person.id || current.deletedAt)
			reject('not_found', 'Confirmed identity was not found.', { id: command.id });
		if (String(current.revision) !== command.expectedRevision)
			reject('revision_conflict', 'This identity changed. Review it before removing it.', {
				id: command.id,
				currentRevision: String(current.revision) as Revision
			});
		const [saved] = await tx
			.update(personIdentities)
			.set({ deletedAt: now, revision: current.revision + 1n, lastSeq: seq, updatedAt: now })
			.where(identity)
			.returning();
		return [{ type: 'person-identity.upsert', identity: identityProjection(saved) }];
	}
	if (current) reject('id_exists', 'This identity ID is already reserved.', { id: command.id });
	const active = await tx
		.select({ id: personIdentities.id })
		.from(personIdentities)
		.where(
			and(
				eq(personIdentities.vaultId, vaultId),
				eq(personIdentities.personId, person.id),
				isNull(personIdentities.deletedAt)
			)
		)
		.limit(MAX_PERSON_IDENTITIES + 1);
	if (active.length >= MAX_PERSON_IDENTITIES)
		reject('identity_limit', 'A person may have at most 50 active confirmed identities.', {
			id: person.id
		});
	const profileUrlHash = createHash('sha256').update(command.profileUrl).digest('hex');
	const [profileMatch] = await tx
		.select({ id: personIdentities.id, profileUrl: personIdentities.profileUrl })
		.from(personIdentities)
		.where(
			and(
				eq(personIdentities.vaultId, vaultId),
				eq(personIdentities.profileUrlHash, profileUrlHash),
				isNull(personIdentities.deletedAt)
			)
		)
		.limit(1);
	if (profileMatch)
		reject(
			profileMatch.profileUrl === command.profileUrl
				? 'duplicate_identity'
				: 'identity_hash_collision',
			'This confirmed profile is already reserved; no people were merged.',
			{ id: command.id, existingId: profileMatch.id }
		);
	if (command.nativeAccountId) {
		const [nativeMatch] = await tx
			.select({ id: personIdentities.id })
			.from(personIdentities)
			.where(
				and(
					eq(personIdentities.vaultId, vaultId),
					eq(personIdentities.platform, command.platform),
					eq(personIdentities.nativeAccountId, command.nativeAccountId),
					isNull(personIdentities.deletedAt)
				)
			)
			.limit(1);
		if (nativeMatch)
			reject(
				'duplicate_identity',
				'This platform account is already assigned; no people were merged.',
				{ id: command.id, existingId: nativeMatch.id }
			);
	}
	const [saved] = await tx
		.insert(personIdentities)
		.values({
			vaultId,
			id: command.id,
			personId: person.id,
			platform: command.platform,
			profileUrl: command.profileUrl,
			profileUrlHash,
			nativeAccountId: command.nativeAccountId ?? null,
			handle: command.handle ?? null,
			revision: 1n,
			lastSeq: seq,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return [{ type: 'person-identity.upsert', identity: identityProjection(saved) }];
}
