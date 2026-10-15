import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import {
	MAX_COMMAND_BYTES,
	serializedBytes,
	type Change,
	type NoteCommand,
	type NoteProjection,
	type Revision,
	type Sequence
} from '#lib/domain/contracts.js';
import { extractReferences } from '#lib/domain/notes.js';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import { entities, entityLinks, noteRevisions, notes } from '../db/schema.js';
import { ApiError } from '../http.js';
import { findEntity, requireEntity, requireTargetKind } from './entities.js';
import { linkProjection } from './links.js';
import { reject } from './rejections.js';

function projection(row: typeof notes.$inferSelect): NoteProjection {
	return {
		entityId: row.entityId,
		bodyMarkdown: row.bodyMarkdown,
		revision: String(row.revision) as Revision,
		lastSeq: String(row.lastSeq) as Sequence,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
export async function replaceNote(
	tx: Transaction,
	vaultId: string,
	command: NoteCommand,
	seq: bigint,
	now: Date
): Promise<Change[]> {
	await requireEntity(tx, vaultId, command.id, true);
	const identity = and(eq(notes.vaultId, vaultId), eq(notes.entityId, command.id));
	const [current] = await tx.select().from(notes).where(identity);
	const currentRevision = current?.revision ?? 0n;
	if (String(currentRevision) !== command.expectedRevision)
		reject(
			'revision_conflict',
			'This note changed on another device. Preserve your draft and review the current note.',
			{ id: command.id, currentRevision: String(currentRevision) as Revision }
		);
	const oldEdges = await tx
		.select({ targetId: entityLinks.targetId })
		.from(entityLinks)
		.where(
			and(
				eq(entityLinks.vaultId, vaultId),
				eq(entityLinks.sourceId, command.id),
				eq(entityLinks.kind, 'note_reference')
			)
		);
	const retained = new Set(oldEdges.map((edge) => edge.targetId));
	const references = extractReferences(command.bodyMarkdown);
	const targets = references.length
		? await tx
				.select({ id: entities.id, kind: entities.kind, purgedAt: entities.purgedAt })
				.from(entities)
				.where(
					and(
						eq(entities.vaultId, vaultId),
						inArray(
							entities.id,
							references.map((reference) => reference.id)
						)
					)
				)
		: [];
	const byId = new Map(targets.map((target) => [target.id, target]));
	for (const reference of references) {
		const target = byId.get(reference.id);
		if (!target)
			reject('not_found', 'Reference target was not found in this vault.', { id: reference.id });
		requireTargetKind(target, reference);
		// Edits may preserve an existing broken link, but never create a new assignment to a tombstone.
		if (target.purgedAt && !retained.has(target.id))
			reject('purged', 'A new reference cannot target a permanently removed entity.', {
				id: target.id
			});
	}
	if (current) {
		await tx.insert(noteRevisions).values({
			vaultId,
			entityId: command.id,
			revision: current.revision,
			bodyMarkdown: current.bodyMarkdown,
			createdAt: current.updatedAt
		});
		// Revisions are consecutive; retain exactly the latest 50 accepted previous bodies.
		await tx
			.delete(noteRevisions)
			.where(
				and(
					eq(noteRevisions.vaultId, vaultId),
					eq(noteRevisions.entityId, command.id),
					lt(noteRevisions.revision, current.revision - 49n)
				)
			);
	}
	const revision = currentRevision + 1n;
	const values = { bodyMarkdown: command.bodyMarkdown, revision, lastSeq: seq, updatedAt: now };
	const [saved] = current
		? await tx.update(notes).set(values).where(identity).returning()
		: await tx
				.insert(notes)
				.values({ vaultId, entityId: command.id, ...values, createdAt: now })
				.returning();
	await tx
		.delete(entityLinks)
		.where(
			and(
				eq(entityLinks.vaultId, vaultId),
				eq(entityLinks.sourceId, command.id),
				eq(entityLinks.kind, 'note_reference')
			)
		);
	if (references.length)
		await tx.insert(entityLinks).values(
			references.map((target) => ({
				vaultId,
				sourceId: command.id,
				targetId: target.id,
				kind: 'note_reference' as const
			}))
		);
	return [
		{ type: 'note.upsert', note: projection(saved) },
		{ type: 'links.replace', links: await linkProjection(tx, vaultId, command.id, seq) }
	];
}

export async function readNoteHistory(owner: OwnerContext, id: string, before?: Revision) {
	return inTransaction(async (tx) => {
		const entity = await findEntity(tx, owner.vaultId, id);
		if (!entity || entity.kind !== 'bookmark' || entity.purgedAt)
			throw new ApiError(404, 'not_found', 'Bookmark note history was not found.');
		const rows = await tx
			.select()
			.from(noteRevisions)
			.where(
				and(
					eq(noteRevisions.vaultId, owner.vaultId),
					eq(noteRevisions.entityId, id),
					before ? lt(noteRevisions.revision, BigInt(before)) : undefined
				)
			)
			.orderBy(desc(noteRevisions.revision))
			.limit(6);
		const items: { revision: Revision; bodyMarkdown: string; acceptedAt: string }[] = [];
		for (const row of rows.slice(0, 5)) {
			const item = {
				revision: String(row.revision) as Revision,
				bodyMarkdown: row.bodyMarkdown,
				acceptedAt: row.createdAt.toISOString()
			};
			if (
				serializedBytes({ items: [...items, item], nextBefore: item.revision }) > MAX_COMMAND_BYTES
			)
				break;
			items.push(item);
		}
		return {
			items,
			nextBefore: rows.length > items.length ? (items.at(-1)?.revision ?? null) : null
		};
	});
}
