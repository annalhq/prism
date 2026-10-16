import { and, eq, inArray, lte, or, isNull } from 'drizzle-orm';
import { uuid } from '#lib/domain/validation-fields.js';
import type { OwnerContext } from '../auth.js';
import { database, inTransaction } from '../db/connection.js';
import { maintenanceJobs, vaults } from '../db/schema.js';
import { ApiError } from '../http.js';
import { processPersonCleanup } from './person-cleanup.js';
import { processPersonaCleanup } from './persona-cleanup.js';

async function claimCleanup(owner: OwnerContext) {
	return inTransaction(async (tx) => {
		const [vault] = await tx
			.select({ id: vaults.id })
			.from(vaults)
			.where(and(eq(vaults.id, owner.vaultId), eq(vaults.ownerSubject, owner.subject)))
			.for('update');
		if (!vault)
			throw new ApiError(403, 'vault_denied', 'This library is not available to this owner.');
		const now = new Date();
		const [job] = await tx
			.select()
			.from(maintenanceJobs)
			.where(
				and(
					eq(maintenanceJobs.vaultId, owner.vaultId),
					inArray(maintenanceJobs.kind, ['person.cleanup', 'persona.cleanup']),
					lte(maintenanceJobs.runAfter, now),
					or(
						eq(maintenanceJobs.state, 'pending'),
						and(
							eq(maintenanceJobs.state, 'running'),
							or(isNull(maintenanceJobs.leaseUntil), lte(maintenanceJobs.leaseUntil, now))
						)
					)
				)
			)
			.orderBy(maintenanceJobs.runAfter, maintenanceJobs.id)
			.limit(1)
			.for('update');
		if (!job) return undefined;
		await tx
			.update(maintenanceJobs)
			.set({
				state: 'running',
				attempts: job.attempts + 1,
				leaseUntil: new Date(now.getTime() + 300_000)
			})
			.where(and(eq(maintenanceJobs.vaultId, owner.vaultId), eq(maintenanceJobs.id, job.id)));
		return job;
	});
}

// One request executes at most ten bounded passes. Media jobs remain pending until
// their provider-aware cleanup implementation is available.
export async function runMaintenance(
	owner: OwnerContext,
	limit = 1
): Promise<{ processed: number; completed: number; pending: number; failed: number }> {
	if (!Number.isInteger(limit) || limit < 1 || limit > 10)
		throw new ApiError(
			400,
			'invalid_limit',
			'Maintenance limit must be an integer between 1 and 10.'
		);
	const summary = { processed: 0, completed: 0, pending: 0, failed: 0 };
	for (let pass = 0; pass < limit; pass++) {
		const job = await claimCleanup(owner);
		if (!job) break;
		summary.processed++;
		try {
			if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload))
				throw new Error('Invalid cleanup payload.');
			const payload = job.payload as Record<string, unknown>;
			const id = uuid(job.kind === 'person.cleanup' ? payload.personId : payload.personaId);
			if (
				job.deduplicationKey !==
				`${job.kind === 'person.cleanup' ? 'purge-person' : 'purge-persona'}:${id}`
			)
				throw new Error('Invalid cleanup identity.');
			const result =
				job.kind === 'person.cleanup'
					? await processPersonCleanup(owner, id)
					: await processPersonaCleanup(owner, id);
			if (result.complete) summary.completed++;
			else summary.pending++;
		} catch {
			summary.failed++;
			// A later manual run can retry; malformed jobs never block other jobs.
			await database()
				.update(maintenanceJobs)
				.set({
					state: 'pending',
					leaseUntil: null,
					runAfter: new Date(Date.now() + Math.min((job.attempts + 1) * 30_000, 600_000))
				})
				.where(and(eq(maintenanceJobs.vaultId, owner.vaultId), eq(maintenanceJobs.id, job.id)));
		}
	}
	return summary;
}
