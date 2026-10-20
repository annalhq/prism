import { and, eq, inArray, sql } from 'drizzle-orm';
import { MAX_SEARCH_FILTER_BYTES, searchTargets, type SearchFilter } from '#lib/domain/search.js';
import type { Change, Revision, SavedSearchProjection, Sequence } from '#lib/domain/contracts.js';
import type { SavedSearchCommand } from '#lib/domain/organization.js';
import type { Transaction } from '../db/connection.js';
import { collections, entities, savedSearches, tags } from '../db/schema.js';
import { reject } from './rejections.js';

async function requireSearchTargets(
	tx: Transaction,
	vaultId: string,
	filter: SearchFilter
): Promise<void> {
	const references = searchTargets(filter);
	for (const kind of ['tag', 'collection', 'person', 'persona'] as const) {
		const targets = references.filter((target) => target.kind === kind);
		if (!targets.length) continue;
		const table = kind === 'tag' ? tags : kind === 'collection' ? collections : entities;
		const rows = await tx
			.select({ id: table.id, deletedAt: table.deletedAt, purgedAt: table.purgedAt })
			.from(table)
			.where(
				and(
					eq(table.vaultId, vaultId),
					inArray(
						table.id,
						targets.map((target) => target.id)
					),
					table === entities ? eq(entities.kind, kind as 'person' | 'persona') : undefined
				)
			);
		const available = new Set(
			rows.filter((row) => !row.deletedAt && !row.purgedAt).map((row) => row.id)
		);
		const missing = targets.find((target) => !available.has(target.id));
		if (missing)
			reject(
				'invalid_reference',
				'This saved search needs an active reference in the same vault. Repair its filter before saving.',
				{ id: missing.id }
			);
	}
}
function projection(row: typeof savedSearches.$inferSelect): SavedSearchProjection {
	return {
		id: row.id,
		name: row.name,
		filter: row.filter as SearchFilter,
		astVersion: 1,
		sort: row.sort as SavedSearchProjection['sort'],
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
export async function changeSavedSearch(
	tx: Transaction,
	vaultId: string,
	command: SavedSearchCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	const identity = and(eq(savedSearches.vaultId, vaultId), eq(savedSearches.id, command.id));
	const [current] = await tx.select().from(savedSearches).where(identity);
	if (command.type === 'saved-search.create') {
		if (current)
			reject('id_exists', 'This saved-search ID is already reserved.', { id: command.id });
	} else {
		if (!current || current.deletedAt || current.purgedAt)
			reject('not_found', 'Saved search was not found.', { id: command.id });
		if (String(current.revision) !== command.expectedRevision)
			reject('revision_conflict', 'This saved search changed. Review its current version.', {
				id: command.id,
				currentRevision: String(current.revision) as Revision
			});
	}
	if (command.type !== 'saved-search.delete') {
		await requireSearchTargets(tx, vaultId, command.filter);
		// Match the existing JSONB constraint, including PostgreSQL's whitespace/escaping.
		const size = await tx.execute<{ bytes: number }>(
			sql`select octet_length(${JSON.stringify(command.filter)}::jsonb::text) as bytes`
		);
		if (size.rows[0].bytes > MAX_SEARCH_FILTER_BYTES)
			reject('invalid_command', 'Stored search filter exceeds 16 KiB.');
	}
	const [saved] =
		command.type === 'saved-search.create'
			? await tx
					.insert(savedSearches)
					.values({
						vaultId,
						id: command.id,
						name: command.name,
						filter: command.filter,
						sort: command.sort,
						astVersion: 1,
						revision: 1n,
						lastSeq: seq,
						createdAt: now,
						updatedAt: now
					})
					.returning()
			: await tx
					.update(savedSearches)
					.set({
						...(command.type === 'saved-search.update'
							? { name: command.name, filter: command.filter, sort: command.sort, astVersion: 1 }
							: { deletedAt: now }),
						revision: current!.revision + 1n,
						lastSeq: seq,
						updatedAt: now
					})
					.where(identity)
					.returning();
	return [{ type: 'saved-search.upsert', savedSearch: projection(saved) }];
}
