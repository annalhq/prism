import { searchLibrary, type LibraryReader } from './search.js';
import type { ReplicaTable } from '#lib/domain/replica.js';

export type SearchSnapshot = Partial<Record<ReplicaTable, Record<string, unknown>[]>>;
// The library is sent once per content version; queries then carry only their parameters.
export type SnapshotMessage = {
	type: 'snapshot';
	contentVersion: number;
	snapshot: SearchSnapshot;
};
export type QueryMessage = {
	type: 'query';
	id: number;
	contentVersion: number;
	view: string;
	input: string;
	sort: string;
};
export type SearchRequest = SnapshotMessage | QueryMessage;
export type SearchResponse = {
	id: number;
	result?: ReturnType<typeof searchLibrary>;
	error?: string;
};
const keyOf = (row: Record<string, unknown>) =>
	String(row.id ?? row.entityId ?? row.bookmarkId ?? row.sourceId);

/** A reader over a snapshot; each table's key lookup is built once, on first use. */
export function snapshotReader(snapshot: SearchSnapshot): LibraryReader {
	const indexes = new Map<ReplicaTable, Map<string, Record<string, unknown>>>();
	return {
		list<T>(table: ReplicaTable): T[] {
			return (snapshot[table] ?? []) as T[];
		},
		get<T>(table: ReplicaTable, key: string): T | undefined {
			let index = indexes.get(table);
			if (!index) {
				index = new Map();
				// The first row with a key wins, as a linear search would find it.
				for (const row of snapshot[table] ?? []) {
					const rowKey = keyOf(row);
					if (!index.has(rowKey)) index.set(rowKey, row);
				}
				indexes.set(table, index);
			}
			return index.get(key) as T | undefined;
		}
	};
}
// This module also exports the deterministic reader for the direct fallback.
if (typeof document === 'undefined' && typeof self !== 'undefined') {
	let current: { contentVersion: number; reader: LibraryReader } | undefined;
	self.onmessage = (event: MessageEvent<SearchRequest>) => {
		const message = event.data;
		if (message.type === 'snapshot') {
			current = {
				contentVersion: message.contentVersion,
				reader: snapshotReader(message.snapshot)
			};
			return;
		}
		const { id, contentVersion, view, input, sort } = message;
		try {
			// Messages arrive in order, so a mismatch means a lost snapshot: answer with an error
			// and the client computes this query itself rather than searching stale data.
			if (!current || current.contentVersion !== contentVersion)
				throw new Error('Search snapshot is not current.');
			self.postMessage({
				id,
				result: searchLibrary(current.reader, view, input, sort)
			} satisfies SearchResponse);
		} catch (error) {
			self.postMessage({
				id,
				error: error instanceof Error ? error.message : String(error)
			} satisfies SearchResponse);
		}
	};
}
