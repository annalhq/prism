import { and, eq, gt, lte } from 'drizzle-orm';
import { MAX_COMMAND_BYTES, serializedBytes, type ChangeFrame } from '#lib/domain/contracts.js';
import type { ChangesPage } from '#lib/domain/replica.js';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import { changeLog, vaults } from '../db/schema.js';
import { ApiError } from '../http.js';
import { decodeCursor, encodeCursor } from './cursors.js';

export async function ownerVault(tx: Transaction, owner: OwnerContext, lock = false) {
	const query = tx
		.select()
		.from(vaults)
		.where(and(eq(vaults.id, owner.vaultId), eq(vaults.ownerSubject, owner.subject)));
	const [vault] = await (lock ? query.for('update') : query);
	if (!vault)
		throw new ApiError(403, 'vault_denied', 'This library is not available to this owner.');
	return vault;
}
export async function pullChanges(owner: OwnerContext, cursor: string): Promise<ChangesPage> {
	return inTransaction(
		async (tx) => {
			const vault = await ownerVault(tx, owner);
			const after = decodeCursor(cursor, owner.vaultId, vault.syncEpoch);
			if (after < vault.retentionFloor || after > vault.changeSeq)
				throw new ApiError(
					410,
					'reset_required',
					'Synchronization history changed. Preserve pending work and rebuild the replica.'
				);
			const rows = await tx
				.select()
				.from(changeLog)
				.where(
					and(
						eq(changeLog.vaultId, owner.vaultId),
						gt(changeLog.seq, after),
						lte(changeLog.seq, vault.changeSeq)
					)
				)
				.orderBy(changeLog.seq)
				.limit(201);
			const frames: ChangeFrame[] = [];
			let seq = after;
			for (const row of rows.slice(0, 200)) {
				if (row.seq !== seq + 1n)
					throw new ApiError(410, 'reset_required', 'Synchronization history is incomplete.');
				if (row.protocolVersion !== 1)
					throw new ApiError(410, 'reset_required', 'Synchronization protocol changed.');
				const frame = row.frame as ChangeFrame;
				const candidate = {
					frames: [...frames, frame],
					cursor: encodeCursor(owner.vaultId, vault.syncEpoch, row.seq),
					// false is one byte longer; reserve the larger response representation.
					hasMore: false,
					epoch: vault.syncEpoch
				};
				if (serializedBytes(candidate) > MAX_COMMAND_BYTES) {
					if (!frames.length)
						throw new ApiError(
							410,
							'reset_required',
							'An older stored frame exceeds the response budget. Rebuild the confirmed replica and preserve pending work.'
						);
					break;
				}
				frames.push(frame);
				seq = row.seq;
			}
			if (seq < vault.changeSeq && !frames.length)
				throw new ApiError(410, 'reset_required', 'Synchronization history is incomplete.');
			return {
				frames,
				cursor: encodeCursor(owner.vaultId, vault.syncEpoch, seq),
				hasMore: seq < vault.changeSeq,
				epoch: vault.syncEpoch
			};
		},
		{ isolationLevel: 'repeatable read', accessMode: 'read only' }
	);
}
