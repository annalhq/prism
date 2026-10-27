import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
	MAX_COMMAND_BYTES,
	serializedBytes,
	type Revision,
	type Sequence
} from '#lib/domain/contracts.js';
import { parsePersonFeedMode, type PersonFeedMode } from '#lib/domain/relationships.js';
import { keys, object, uuid, ValidationError } from '#lib/domain/validation-fields.js';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import { bookmarks, contentPeople, entities, notes, personIdentities } from '../db/schema.js';
import { ApiError } from '../http.js';
import { findEntity } from './entities.js';
import { identityProjection } from './identities.js';
import { noteProjection } from './notes.js';
import { personProjection } from './projections.js';
import { contentPersonProjection } from './relationships.js';

type FeedCursor = { personId: string; mode: PersonFeedMode; createdAt: string; id: string };
export function feedParameters(
	personId: string,
	modeInput: string | null,
	cursorInput: string | null
): { mode: PersonFeedMode; cursor?: FeedCursor } {
	try {
		const mode = parsePersonFeedMode(modeInput ?? 'all');
		if (cursorInput === null) return { mode };
		if (cursorInput.length > 512 || !/^[\w-]+$/.test(cursorInput))
			throw new ValidationError('Invalid person feed cursor.');
		const bytes = Buffer.from(cursorInput, 'base64url');
		if (bytes.toString('base64url') !== cursorInput)
			throw new ValidationError('Invalid person feed cursor.');
		const value = object(JSON.parse(bytes.toString('utf8')));
		keys(value, ['personId', 'mode', 'createdAt', 'id']);
		if (
			value.personId !== personId ||
			value.mode !== mode ||
			typeof value.createdAt !== 'string' ||
			!Number.isFinite(Date.parse(value.createdAt)) ||
			new Date(value.createdAt).toISOString() !== value.createdAt
		)
			throw new ValidationError('Feed cursor does not match this person/view.');
		return { mode, cursor: { personId, mode, createdAt: value.createdAt, id: uuid(value.id) } };
	} catch {
		throw new ApiError(
			400,
			'invalid_feed_parameters',
			'Use a valid feed mode and its matching cursor.'
		);
	}
}
function encodeCursor(cursor: FeedCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
async function readablePerson(tx: Transaction, vaultId: string, id: string, allowTrash: boolean) {
	const entity = await findEntity(tx, vaultId, id);
	if (!entity || entity.kind !== 'person' || entity.purgedAt || (!allowTrash && entity.deletedAt))
		throw new ApiError(404, 'not_found', 'Person was not found.');
	return entity;
}
const readSnapshot = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
export async function readPerson(owner: OwnerContext, id: string) {
	return inTransaction(async (tx) => {
		await readablePerson(tx, owner.vaultId, id, true);
		const person = await personProjection(tx, owner.vaultId, id);
		const [note] = await tx
			.select()
			.from(notes)
			.where(and(eq(notes.vaultId, owner.vaultId), eq(notes.entityId, id)));
		const result = { person, note: note ? noteProjection(note) : null };
		if (serializedBytes(result) > MAX_COMMAND_BYTES)
			throw new ApiError(
				413,
				'response_too_large',
				'The profile response exceeds its size budget.'
			);
		return result;
	}, readSnapshot);
}
export async function readPersonIdentities(owner: OwnerContext, id: string, after?: string) {
	return inTransaction(async (tx) => {
		await readablePerson(tx, owner.vaultId, id, true);
		const rows = await tx
			.select()
			.from(personIdentities)
			.where(
				and(
					eq(personIdentities.vaultId, owner.vaultId),
					eq(personIdentities.personId, id),
					isNull(personIdentities.deletedAt),
					isNull(personIdentities.purgedAt),
					after ? sql`${personIdentities.id} > ${after}::uuid` : undefined
				)
			)
			.orderBy(asc(personIdentities.id))
			.limit(21);
		const items: ReturnType<typeof identityProjection>[] = [];
		for (const row of rows.slice(0, 20)) {
			const item = identityProjection(row);
			if (serializedBytes({ items: [...items, item], nextAfter: item.id }) > MAX_COMMAND_BYTES)
				break;
			items.push(item);
		}
		return { items, nextAfter: rows.length > items.length ? (items.at(-1)?.id ?? null) : null };
	}, readSnapshot);
}
export async function readPersonFeed(
	owner: OwnerContext,
	id: string,
	parameters: { mode: PersonFeedMode; cursor?: FeedCursor }
) {
	return inTransaction(async (tx) => {
		await readablePerson(tx, owner.vaultId, id, false);
		const { mode, cursor } = parameters;
		// A membership subquery yields one bookmark row even when legacy rows hold several roles.
		const linked = tx
			.select({ id: contentPeople.bookmarkId })
			.from(contentPeople)
			.where(
				and(
					eq(contentPeople.vaultId, owner.vaultId),
					eq(contentPeople.personId, id),
					isNull(contentPeople.deletedAt),
					isNull(contentPeople.purgedAt)
				)
			);
		const rows = await tx
			.select({
				id: bookmarks.id,
				kind: bookmarks.kind,
				title: bookmarks.title,
				url: bookmarks.url,
				domain: bookmarks.domain,
				readingStatus: bookmarks.readingStatus,
				createdAt: bookmarks.createdAt,
				updatedAt: entities.updatedAt,
				revision: entities.revision,
				lastSeq: entities.lastSeq
			})
			.from(bookmarks)
			.innerJoin(
				entities,
				and(eq(entities.vaultId, bookmarks.vaultId), eq(entities.id, bookmarks.id))
			)
			.where(
				and(
					eq(bookmarks.vaultId, owner.vaultId),
					isNull(entities.deletedAt),
					isNull(entities.purgedAt),
					inArray(bookmarks.id, linked),
					cursor
						? sql`(${bookmarks.createdAt}, ${bookmarks.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
						: undefined,
					mode === 'tweets'
						? and(
								eq(bookmarks.kind, 'social'),
								or(
									sql`lower(rtrim(${bookmarks.domain}, '.')) = 'x.com'`,
									sql`lower(rtrim(${bookmarks.domain}, '.')) like '%.x.com'`,
									sql`lower(rtrim(${bookmarks.domain}, '.')) = 'twitter.com'`,
									sql`lower(rtrim(${bookmarks.domain}, '.')) like '%.twitter.com'`
								)
							)
						: undefined
				)
			)
			.orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
			.limit(51);
		const ids = rows.slice(0, 50).map((row) => row.id);
		const roles = ids.length
			? await tx
					.select()
					.from(contentPeople)
					.where(
						and(
							eq(contentPeople.vaultId, owner.vaultId),
							eq(contentPeople.personId, id),
							inArray(contentPeople.bookmarkId, ids),
							isNull(contentPeople.deletedAt),
							isNull(contentPeople.purgedAt)
						)
					)
					.orderBy(contentPeople.bookmarkId, contentPeople.role)
			: [];
		const candidates = rows.slice(0, 50).map((row) => ({
			bookmark: {
				...row,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				revision: String(row.revision) as Revision,
				lastSeq: String(row.lastSeq) as Sequence
			},
			relationships: roles
				.filter((relationship) => relationship.bookmarkId === row.id)
				.map(contentPersonProjection)
		}));
		const items: typeof candidates = [];
		for (const item of candidates) {
			const nextAfter = encodeCursor({
				personId: id,
				mode,
				createdAt: item.bookmark.createdAt,
				id: item.bookmark.id
			});
			if (serializedBytes({ items: [...items, item], nextAfter }) > MAX_COMMAND_BYTES) break;
			items.push(item);
		}
		const last = items.at(-1)?.bookmark;
		return {
			items,
			nextAfter:
				rows.length > items.length && last
					? encodeCursor({ personId: id, mode, createdAt: last.createdAt, id: last.id })
					: null
		};
	}, readSnapshot);
}
