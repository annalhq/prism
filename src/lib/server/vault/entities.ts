import { and, eq } from 'drizzle-orm';
import type { EntityReference } from '#lib/domain/notes.js';
import type { Transaction } from '../db/connection.js';
import { entities } from '../db/schema.js';
import { reject } from './rejections.js';

export async function findEntity(tx: Transaction, vaultId: string, id: string) {
	const [entity] = await tx
		.select()
		.from(entities)
		.where(and(eq(entities.vaultId, vaultId), eq(entities.id, id)));
	return entity;
}
export async function requireEntity(
	tx: Transaction,
	vaultId: string,
	id: string,
	writable = false
) {
	const entity = await findEntity(tx, vaultId, id);
	if (!entity) reject('not_found', 'Entity was not found.', { id });
	if (writable && entity.purgedAt)
		reject('purged', 'This entity has been permanently removed.', { id });
	if (writable && entity.deletedAt)
		reject('in_trash', 'Restore this entity before editing it.', { id });
	return entity;
}
export function requireTargetKind(
	entity: Pick<typeof entities.$inferSelect, 'kind'>,
	target: EntityReference
): void {
	if (entity.kind !== target.kind)
		reject(
			'invalid_command',
			'The reference destination does not match the registered entity kind.',
			{ id: target.id }
		);
}
