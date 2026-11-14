import { isPersonaCommand } from '#lib/domain/personas.js';
import { applyPersonaCommand } from './personas.js';
import { changePerson } from './people.js';
import { changeIdentity } from './identities.js';
import { changeContentPerson } from './relationships.js';
import { tagTweet } from './tweets.js';
import { CONNECTION_ROLE } from '#lib/domain/relationships.js';
import { createHash } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
	MAX_COMMAND_BYTES,
	serializedBytes,
	type BookmarkCommand,
	type Change,
	type ChangeFrame,
	type CommandResult,
	type Revision,
	type Sequence
} from '#lib/domain/contracts.js';
import { normalizeUrl } from '#lib/domain/urls.js';
import { parseCommand, ValidationError } from '#lib/domain/validation.js';
import type { OwnerContext } from '../auth.js';
import { inTransaction, type Transaction } from '../db/connection.js';
import { bookmarks, changeLog, entities, tags, vaults } from '../db/schema.js';
import { ApiError } from '../http.js';
import { bookmarkProjection } from './projections.js';
import { prepareEnvelope, readReceipt, writeReceipt } from './receipts.js';
import { purgeBookmark } from './purge.js';
import { replaceNote } from './notes.js';
import { changeRelatedLink } from './links.js';
import { Rejected, reject } from './rejections.js';
import { changeTaxonomy, changeTagMembership, organizeBookmark } from './organization.js';
import { applyAppearanceCommand } from './themes.js';
import { isAppearanceCommand } from '#lib/domain/appearance.js';
import { changeSavedSearch } from './saved-searches.js';
import { recordOpen } from './activity.js';
import {
	isOrganizationCommand,
	normalizeOrganizationName,
	type OrganizationCommand
} from '#lib/domain/organization.js';

class AlreadyExists extends Error {
	constructor(readonly id: string) {
		super('Bookmark already exists.');
	}
}
const hashUrl = (url: string | null) =>
	url === null ? null : createHash('sha256').update(url).digest('hex');

async function ensureUniqueUrl(
	tx: Transaction,
	vaultId: string,
	id: string,
	canonicalUrl: string | null,
	create: boolean
) {
	const hash = hashUrl(canonicalUrl);
	if (!hash) return;
	const [existing] = await tx
		.select({ id: entities.id, canonicalUrl: bookmarks.canonicalUrl })
		.from(entities)
		.innerJoin(
			bookmarks,
			and(eq(bookmarks.vaultId, entities.vaultId), eq(bookmarks.id, entities.id))
		)
		.where(
			and(
				eq(entities.vaultId, vaultId),
				eq(entities.urlHash, hash),
				isNull(entities.deletedAt),
				ne(entities.id, id)
			)
		);
	if (!existing) return;
	if (existing.canonicalUrl !== canonicalUrl)
		reject('url_hash_collision', 'URL hash collision; no content was merged.', {
			id,
			existingId: existing.id
		});
	if (create) throw new AlreadyExists(existing.id);
	reject('duplicate_url', 'Another active bookmark already uses this URL.', {
		id,
		existingId: existing.id
	});
}

async function applyBookmark(
	tx: Transaction,
	vaultId: string,
	command: BookmarkCommand,
	seq: bigint,
	now: Date
): Promise<Change> {
	const id = command.id;
	const identity = and(eq(entities.vaultId, vaultId), eq(entities.id, id));
	const bookmarkIdentity = and(eq(bookmarks.vaultId, vaultId), eq(bookmarks.id, id));
	const [entity] = await tx.select().from(entities).where(identity);
	if (command.type === 'bookmark.create') {
		if (entity)
			reject(
				'id_exists',
				'This entity ID is already in use, including trashed or purged identities.',
				{ id }
			);
		const normalized = command.url
			? normalizeUrl(command.url)
			: { url: null, canonicalUrl: null, domain: null };
		await ensureUniqueUrl(tx, vaultId, id, normalized.canonicalUrl, true);
		// Imports carry the original save time so they sort among existing bookmarks by age.
		const createdAt = command.createdAt ? new Date(command.createdAt) : now;
		await tx.insert(entities).values({
			vaultId,
			id,
			kind: 'bookmark',
			urlHash: hashUrl(normalized.canonicalUrl),
			lastSeq: seq,
			createdAt,
			updatedAt: now
		});
		await tx.insert(bookmarks).values({
			vaultId,
			id,
			kind: command.kind,
			title: command.title,
			description: command.description ?? '',
			...normalized,
			createdAt
		});
		return { type: 'bookmark.upsert', bookmark: await bookmarkProjection(tx, vaultId, id) };
	}
	if (!entity || entity.kind !== 'bookmark') reject('not_found', 'Bookmark was not found.', { id });
	if (entity.purgedAt) reject('purged', 'This bookmark has been permanently removed.', { id });
	if (String(entity.revision) !== command.expectedRevision)
		reject(
			'revision_conflict',
			'This bookmark changed on another device. Review the current version before retrying.',
			{ id, currentRevision: String(entity.revision) as Revision }
		);
	if (command.type === 'bookmark.restore') {
		if (!entity.deletedAt)
			reject('not_in_trash', 'Only a trashed bookmark can be restored.', { id });
	} else if (command.type === 'bookmark.purge') {
		if (!entity.deletedAt)
			reject('not_in_trash', 'Move this bookmark to trash before permanently removing it.', { id });
	} else if (
		entity.deletedAt &&
		!(
			command.type === 'bookmark.organize' &&
			Object.keys(command.patch).length === 1 &&
			command.patch.collectionId === null
		)
	)
		reject('in_trash', 'Restore this bookmark before editing or trashing it again.', { id });

	const revision = entity.revision + 1n;
	if (command.type === 'bookmark.purge') {
		await tx
			.update(entities)
			.set({
				revision,
				lastSeq: seq,
				updatedAt: now,
				purgedAt: now,
				urlHash: null,
				personaName: null
			})
			.where(identity);
		await purgeBookmark(tx, vaultId, id);
		return {
			type: 'bookmark.purge',
			tombstone: {
				id,
				kind: 'bookmark',
				revision: String(revision) as Revision,
				lastSeq: String(seq) as Sequence,
				deletedAt: entity.deletedAt!.toISOString(),
				purgedAt: now.toISOString()
			}
		};
	}
	const [bookmark] = await tx.select().from(bookmarks).where(bookmarkIdentity);
	if (!bookmark) throw new Error('Bookmark subtype invariant failed.');
	let urlHash = entity.urlHash;
	if (command.type === 'bookmark.update') {
		const inputUrl = command.patch.url === undefined ? bookmark.url : command.patch.url;
		if (!['image', 'text', 'stash'].includes(bookmark.kind) && inputUrl === null)
			reject('invalid_command', 'Page and social bookmarks require a URL.', { id });
		const normalized = inputUrl
			? normalizeUrl(inputUrl)
			: { url: null, canonicalUrl: null, domain: null };
		await ensureUniqueUrl(tx, vaultId, id, normalized.canonicalUrl, false);
		urlHash = hashUrl(normalized.canonicalUrl);
		await tx
			.update(bookmarks)
			.set({ ...command.patch, ...normalized })
			.where(bookmarkIdentity);
	}
	if (command.type === 'bookmark.organize')
		await organizeBookmark(tx, vaultId, id, command.patch, bookmark, now);
	if (command.type === 'bookmark.restore')
		await ensureUniqueUrl(tx, vaultId, id, bookmark.canonicalUrl, false);
	await tx
		.update(entities)
		.set({
			revision,
			lastSeq: seq,
			updatedAt: now,
			urlHash,
			deletedAt:
				command.type === 'bookmark.trash'
					? now
					: command.type === 'bookmark.restore'
						? null
						: entity.deletedAt
		})
		.where(identity);
	return { type: 'bookmark.upsert', bookmark: await bookmarkProjection(tx, vaultId, id) };
}

async function applyOrganization(
	tx: Transaction,
	vaultId: string,
	command: OrganizationCommand,
	seq: bigint,
	now: Date,
	bookmarkOnly = false
): Promise<Change[]> {
	switch (command.type) {
		case 'tag.add':
		case 'tag.remove':
			return changeTagMembership(tx, vaultId, command, seq, now, bookmarkOnly);
		case 'saved-search.create':
		case 'saved-search.update':
		case 'saved-search.delete':
			return changeSavedSearch(tx, vaultId, command, seq, now);
		case 'activity.open':
			return recordOpen(tx, vaultId, command.id, seq, now);
		default:
			return changeTaxonomy(tx, vaultId, command, seq, now);
	}
}

export async function executeCommand(owner: OwnerContext, input: unknown): Promise<CommandResult> {
	// Both the route and service enforce size; internal callers cannot bypass the budget.
	const envelope = prepareEnvelope(input);
	if (serializedBytes(input) > MAX_COMMAND_BYTES)
		throw new ApiError(413, 'body_too_large', 'Request body exceeds the limit.');
	const { operationId, requestHash } = envelope;
	return inTransaction(async (tx) => {
		const [vault] = await tx
			.select()
			.from(vaults)
			.where(and(eq(vaults.id, owner.vaultId), eq(vaults.ownerSubject, owner.subject)))
			.for('update');
		if (!vault)
			throw new ApiError(403, 'vault_denied', 'This library is not available to this owner.');
		const receipt = await readReceipt(tx, owner.vaultId, operationId, requestHash);
		if (receipt) return receipt;
		let result: CommandResult;
		try {
			// A savepoint lets terminal rejection roll back all tentative content/sequence
			// writes while retaining the vault lock and recording the rejection receipt.
			result = await tx.transaction(async (mutation) => {
				const command = parseCommand(envelope.command);
				const seq = vault.changeSeq + 1n;
				const now = new Date();
				const changes: Change[] = [];
				if (command.type === 'extension.bookmark.create') {
					const { tagIds, newTags, person, ...bookmark } = command;
					changes.push(
						await applyBookmark(
							mutation,
							owner.vaultId,
							{ ...bookmark, type: 'bookmark.create' },
							seq,
							now
						)
					);
					// New tags join the chosen ones: an active tag with the same name is reused (it
					// may have been made in Prism since the extension's catalog loaded); otherwise
					// the tag is created with the extension's ID.
					const chosen = new Set(tagIds);
					for (const tag of newTags ?? []) {
						const [existing] = await mutation
							.select({ id: tags.id })
							.from(tags)
							.where(
								and(
									eq(tags.vaultId, owner.vaultId),
									eq(tags.normalizedName, normalizeOrganizationName(tag.name).normalizedName),
									isNull(tags.deletedAt)
								)
							)
							.limit(1);
						if (existing) chosen.add(existing.id);
						else {
							changes.push(
								...(await applyOrganization(
									mutation,
									owner.vaultId,
									{ type: 'tag.create', id: tag.id, name: tag.name },
									seq,
									now
								))
							);
							chosen.add(tag.id);
						}
					}
					for (const tagId of chosen) {
						changes.push(
							...(await applyOrganization(
								mutation,
								owner.vaultId,
								{ type: 'tag.add', id: command.id, tagId },
								seq,
								now,
								true
							))
						);
					}
					changes.push(
						...(await tagTweet(mutation, owner.vaultId, command.id, command.url, seq, now))
					);
					if (person) {
						changes.push(
							...(await changeContentPerson(
								mutation,
								owner.vaultId,
								{
									type: 'content-person.add',
									bookmarkId: command.id,
									personId: person.id,
									role: CONNECTION_ROLE,
									provenance: 'manual'
								},
								seq,
								now
							))
						);
					}
				} else if (isPersonaCommand(command)) {
					changes.push(...(await applyPersonaCommand(mutation, owner.vaultId, command, seq, now)));
				} else if (command.type === 'note.replace') {
					changes.push(...(await replaceNote(mutation, owner.vaultId, command, seq, now)));
				} else if (command.type === 'related-link.add' || command.type === 'related-link.remove') {
					changes.push(...(await changeRelatedLink(mutation, owner.vaultId, command, seq, now)));
				} else if (
					command.type === 'person-identity.add' ||
					command.type === 'person-identity.remove'
				) {
					changes.push(...(await changeIdentity(mutation, owner.vaultId, command, seq, now)));
				} else if (
					command.type === 'content-person.add' ||
					command.type === 'content-person.remove'
				) {
					changes.push(...(await changeContentPerson(mutation, owner.vaultId, command, seq, now)));
				} else if (
					command.type === 'person.create' ||
					command.type === 'person.update' ||
					command.type === 'person.trash' ||
					command.type === 'person.restore' ||
					command.type === 'person.purge'
				) {
					changes.push(...(await changePerson(mutation, owner.vaultId, command, seq, now)));
				} else if (isOrganizationCommand(command)) {
					changes.push(...(await applyOrganization(mutation, owner.vaultId, command, seq, now)));
				} else if (isAppearanceCommand(command)) {
					changes.push(
						...(await applyAppearanceCommand(mutation, owner.vaultId, command, seq, now))
					);
				} else {
					for (const item of command.type === 'bookmark.bulk' ? command.commands : [command]) {
						try {
							if (isOrganizationCommand(item)) {
								changes.push(
									...(await applyOrganization(mutation, owner.vaultId, item, seq, now, true))
								);
							} else {
								changes.push(await applyBookmark(mutation, owner.vaultId, item, seq, now));
								if (item.type === 'bookmark.create')
									changes.push(
										...(await tagTweet(mutation, owner.vaultId, item.id, item.url, seq, now))
									);
							}
						} catch (error) {
							if (error instanceof AlreadyExists && command.type === 'bookmark.bulk')
								reject(
									'duplicate_url',
									'A bulk create duplicates an active bookmark; the entire chunk was rejected.',
									{ id: item.id, existingId: error.id }
								);
							throw error;
						}
					}
				}
				const frame: ChangeFrame = {
					protocolVersion: 1,
					operationId,
					seq: String(seq) as Sequence,
					changes
				};
				const accepted = { protocolVersion: 1, operationId, status: 'accepted', frame } as const;
				// Reserve space for the sync cursor/page wrapper around this whole frame.
				if (serializedBytes(accepted) > MAX_COMMAND_BYTES - 1024)
					reject(
						'frame_too_large',
						'The resulting change frame exceeds 1 MiB. Split the operation into smaller chunks.'
					);
				// jsonb::text has different whitespace from wire JSON. Check the DB budget
				// explicitly too, before inserting a row with the database CHECK constraint.
				const size = await mutation.execute<{ bytes: number }>(
					sql`SELECT octet_length(${JSON.stringify(frame)}::jsonb::text) AS bytes`
				);
				if (size.rows[0].bytes > MAX_COMMAND_BYTES)
					reject(
						'frame_too_large',
						'The stored change frame exceeds 1 MiB. Split the operation into smaller chunks.'
					);
				await mutation.update(vaults).set({ changeSeq: seq }).where(eq(vaults.id, owner.vaultId));
				await mutation.insert(changeLog).values({ vaultId: owner.vaultId, seq, frame });
				return accepted;
			});
		} catch (error) {
			if (error instanceof AlreadyExists)
				result = {
					protocolVersion: 1,
					operationId,
					status: 'already_exists',
					bookmark: await bookmarkProjection(tx, owner.vaultId, error.id)
				};
			else if (error instanceof Rejected || error instanceof ValidationError)
				result = {
					protocolVersion: 1,
					operationId,
					status: 'rejected',
					error:
						error instanceof Rejected
							? error.detail
							: { code: 'invalid_command', message: error.message }
				};
			else throw error; // Connection failures/deadlocks/unknown constraints roll back; retry same ID.
		}
		await writeReceipt(tx, owner.vaultId, operationId, requestHash, result);
		return result;
	});
}
