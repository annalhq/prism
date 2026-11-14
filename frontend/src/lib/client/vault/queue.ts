import type { Command, Revision } from '#lib/domain/contracts.js';
import type { ReplicaTable } from '#lib/domain/replica.js';
import type { PendingOperation } from './storage.js';
import { recordKey } from './storage.js';
import type { Records } from './projections.js';

function children(command: Command): Exclude<Command, { type: 'bookmark.bulk' }>[] {
	return command.type === 'bookmark.bulk' ? command.commands : [command];
}
// Keys describe the server revision a command reads or changes. Notes have an
// independent revision; tag membership and related links use the entity revision.
function revisionKey(command: ReturnType<typeof children>[number]): string | undefined {
	if (!('id' in command)) return;
	const kind = command.type.split('.')[0];
	const tables: Record<string, ReplicaTable> = {
		bookmark: 'bookmarks',
		person: 'people',
		persona: 'personas',
		note: 'notes',
		tag: 'tags',
		collection: 'collections',
		folder: 'folders',
		'saved-search': 'savedSearches',
		'person-identity': 'identities',
		'related-link': 'entities'
	};
	if (command.type === 'tag.add' || command.type === 'tag.remove')
		return recordKey('entities', command.id);
	const table = tables[kind];
	return table ? recordKey(table, command.id) : undefined;
}
function equivalent(key: string): string {
	return key.replace(/^(bookmarks|people|personas):/, 'entities:');
}
export function dependencies(command: Command, queued: PendingOperation[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const child of children(command)) {
		if (!('expectedRevision' in child)) continue;
		const key = revisionKey(child);
		if (!key) continue;
		const previous = queued.findLast((item) =>
			children(item.envelope.command).some((prior) => {
				const priorKey = revisionKey(prior);
				return priorKey && equivalent(priorKey) === equivalent(key);
			})
		);
		if (previous) result[key] = previous.operationId;
	}
	return result;
}
export function acknowledge(
	item: PendingOperation,
	operationId: string,
	receipt: Records
): PendingOperation {
	const next = structuredClone(item);
	for (const child of children(next.envelope.command)) {
		const key = revisionKey(child);
		if (!key || next.dependencies?.[key] !== operationId || !('expectedRevision' in child))
			continue;
		const revision = (
			receipt.get(key) ??
			[...receipt].find(([candidate]) => equivalent(candidate) === equivalent(key))?.[1]
		)?.value.revision;
		if (typeof revision === 'string') {
			child.expectedRevision = revision as Revision;
			delete next.dependencies[key];
		}
	}
	return next;
}
