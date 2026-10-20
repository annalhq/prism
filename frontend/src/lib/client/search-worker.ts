import { searchLibrary, type LibraryReader } from './search.js';
import type { ReplicaTable } from '#lib/domain/replica.js';

export type SearchSnapshot = Partial<Record<ReplicaTable, Record<string, unknown>[]>>;
export type SearchRequest = {
	id: number;
	snapshot: SearchSnapshot;
	view: string;
	input: string;
	sort: string;
};
export type SearchResponse = {
	id: number;
	result?: ReturnType<typeof searchLibrary>;
	error?: string;
};
export function snapshotReader(snapshot: SearchSnapshot): LibraryReader {
	return {
		list<T>(table: ReplicaTable): T[] {
			return (snapshot[table] ?? []) as T[];
		},
		get<T>(table: ReplicaTable, key: string): T | undefined {
			return snapshot[table]?.find(
				(row) => String(row.id ?? row.entityId ?? row.bookmarkId ?? row.sourceId) === key
			) as T | undefined;
		}
	};
}
// This module also exports the deterministic reader for the direct fallback.
if (typeof document === 'undefined' && typeof self !== 'undefined') {
	self.onmessage = (event: MessageEvent<SearchRequest>) => {
		const { id, snapshot, view, input, sort } = event.data;
		try {
			self.postMessage({
				id,
				result: searchLibrary(snapshotReader(snapshot), view, input, sort)
			} satisfies SearchResponse);
		} catch (error) {
			self.postMessage({
				id,
				error: error instanceof Error ? error.message : String(error)
			} satisfies SearchResponse);
		}
	};
}
