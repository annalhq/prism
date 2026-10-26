import type { ReplicaTable } from './replica.js';

type Row = Record<string, unknown>;
/** The read-only library sent to anonymous visitors of /public. */
export type PublicSnapshot = {
	bookmarks: Row[];
	people: Row[];
	tags: Row[];
	relationships: Row[];
	notes: Row[];
};

/** Serves a snapshot through the same reader interface search and feeds use for the replica. */
export function snapshotLibrary(snapshot: PublicSnapshot) {
	const tables: Partial<Record<ReplicaTable, Row[]>> = snapshot;
	const keyOf = (row: Row) => String(row.id ?? row.entityId ?? '');
	const indexes = new Map<ReplicaTable, Map<string, Row>>();
	return {
		list<T>(table: ReplicaTable): T[] {
			return (tables[table] ?? []) as T[];
		},
		get<T>(table: ReplicaTable, key: string): T | undefined {
			let index = indexes.get(table);
			if (!index) {
				index = new Map((tables[table] ?? []).map((row) => [keyOf(row), row]));
				indexes.set(table, index);
			}
			return index.get(key) as T | undefined;
		}
	};
}
export type SnapshotLibrary = ReturnType<typeof snapshotLibrary>;
