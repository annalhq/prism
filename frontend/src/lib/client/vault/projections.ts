import type { ChangeFrame, Command } from '#lib/domain/contracts.js';
import type { ReplicaRecord, ReplicaTable } from '#lib/domain/replica.js';
import { recordKey } from './storage.js';

export type Records = Map<string, ReplicaRecord>;
export function putRecord(records: Records, record: ReplicaRecord): void {
	const key = recordKey(record.table, record.key);
	const previous = records.get(key);
	if (!previous || BigInt(record.lastSeq) >= BigInt(previous.lastSeq)) records.set(key, record);
}
const projectionTables: Record<string, ReplicaTable> = {
	bookmark: 'bookmarks',
	entity: 'entities',
	person: 'people',
	persona: 'personas',
	note: 'notes',
	tag: 'tags',
	collection: 'collections',
	folder: 'folders',
	theme: 'themes',
	appearance: 'appearance',
	savedSearch: 'savedSearches',
	activity: 'activity',
	identity: 'identities',
	relationship: 'relationships',
	membership: 'memberships',
	links: 'links'
};
export function projectionKey(table: ReplicaTable, value: Record<string, unknown>): string {
	if (table === 'relationships') return `${value.bookmarkId}/${value.personId}/${value.role}`;
	if (table === 'memberships') return `${value.personaId}/${(value.member as { id: string }).id}`;
	return String(value.id ?? value.entityId ?? value.bookmarkId ?? value.sourceId);
}
export function applyFrame(records: Records, frame: ChangeFrame): void {
	for (const change of frame.changes) {
		const entry = change as unknown as Record<string, unknown>;
		if (change.type.endsWith('.purge')) {
			const tombstone = entry.tombstone as Record<string, unknown>;
			const id = tombstone.id;
			for (const [key, row] of records) {
				if (row.table === 'entities') continue;
				const value = row.value;
				if (
					row.key === id ||
					value.entityId === id ||
					value.bookmarkId === id ||
					value.sourceId === id ||
					value.personId === id ||
					value.personaId === id ||
					(value.member as { id?: string } | undefined)?.id === id
				)
					records.delete(key);
			}
			const prior = records.get(recordKey('entities', String(id)))?.value;
			putRecord(records, {
				table: 'entities',
				key: String(id),
				lastSeq: frame.seq,
				value: { ...prior, ...tombstone }
			});
			continue;
		}
		for (const [field, table] of Object.entries(projectionTables)) {
			if (!(field in entry)) continue;
			const value = entry[field] as Record<string, unknown>;
			const ownerIds = [
				value.entityId,
				value.bookmarkId,
				value.sourceId,
				value.personId,
				value.personaId,
				(value.member as { id?: string } | undefined)?.id
			];
			if (['bookmarks', 'people', 'personas'].includes(table)) ownerIds.push(value.id);
			if (
				table !== 'entities' &&
				ownerIds.some(
					(id) => typeof id === 'string' && records.get(recordKey('entities', id))?.value.purgedAt
				)
			)
				continue;
			putRecord(records, {
				table,
				key: projectionKey(table, value),
				lastSeq: (value.lastSeq ?? frame.seq) as `${bigint}`,
				value
			});
		}
	}
}

// Optimism is a separate view; expectedRevision always refers to confirmed data.
export function overlay(records: Records, command: Command): void {
	const c = command as unknown as Record<string, unknown>;
	if (command.type === 'bookmark.bulk') {
		for (const child of command.commands) overlay(records, child);
		return;
	}
	const [kind, action] = command.type.split('.');
	const table = (
		{
			bookmark: 'bookmarks',
			person: 'people',
			persona: 'personas',
			tag: 'tags',
			collection: 'collections',
			folder: 'folders',
			theme: 'themes',
			appearance: 'appearance',
			'saved-search': 'savedSearches',
			note: 'notes',
			'person-identity': 'identities',
			'content-person': 'relationships',
			'persona-member': 'memberships'
		} as Record<string, ReplicaTable>
	)[kind];
	if (!table) return;
	const id =
		table === 'relationships'
			? `${c.bookmarkId}/${c.personId}/${c.role}`
			: table === 'memberships'
				? `${c.personaId}/${(c.member as { id: string })?.id}`
				: String(c.id);
	const key = recordKey(table, id);
	const current = records.get(key)?.value;
	const now = new Date().toISOString();
	const value: Record<string, unknown> = { ...current };
	if (action === 'create')
		Object.assign(value, {
			revision: '0',
			lastSeq: '0',
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			tagIds: [],
			readingStatus: 'unread',
			isPinned: false,
			archivedAt: null,
			collectionId: null,
			description: '',
			bio: '',
			website: null,
			...c
		});
	else if (action === 'update') Object.assign(value, c.patch ?? c);
	else if (action === 'rename') value.name = c.name;
	else if (action === 'move') value.position = c.position;
	else if (action === 'privacy') value.isPrivate = c.isPrivate;
	else if (action === 'folder') value.folderId = c.folderId;
	else if (action === 'toggle') value.enabled = c.enabled;
	else if (action === 'set') value.activeTheme = c.activeTheme;
	else if (action === 'replace')
		Object.assign(value, {
			entityId: c.id,
			bodyMarkdown: c.bodyMarkdown,
			revision: current?.revision ?? '0',
			lastSeq: current?.lastSeq ?? '0',
			updatedAt: now,
			createdAt: current?.createdAt ?? now
		});
	else if (action === 'organize') {
		Object.assign(value, c.patch);
		if ('isArchived' in (c.patch as object))
			value.archivedAt = (c.patch as { isArchived: boolean }).isArchived ? now : null;
	} else if (action === 'trash' || action === 'delete' || action === 'remove')
		value.deletedAt = now;
	else if (action === 'restore') value.deletedAt = null;
	else if (action === 'purge') {
		records.delete(key);
		return;
	} else if (action === 'add')
		Object.assign(value, {
			revision: '0',
			lastSeq: '0',
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			...c
		});
	else return;
	if (kind === 'tag' && (action === 'add' || action === 'remove')) {
		for (const t of ['entities', 'bookmarks', 'people', 'personas'] as const) {
			const previous = records.get(recordKey(t, String(c.id)));
			if (previous) {
				const ids = new Set(previous.value.tagIds as string[]);
				if (action === 'add') ids.add(String(c.tagId));
				else ids.delete(String(c.tagId));
				records.set(recordKey(t, String(c.id)), {
					...previous,
					value: { ...previous.value, tagIds: [...ids] }
				});
			}
		}
		return;
	}
	records.set(key, { table, key: id, lastSeq: (current?.lastSeq ?? '0') as `${bigint}`, value });
}
