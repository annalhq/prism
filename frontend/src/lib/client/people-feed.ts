import type { ReplicaTable } from '#lib/domain/replica.js';
type Row = Record<string, unknown>;

/**
 * Person → the bookmarks connected to them. A connection is one explicit choice; rows saved
 * before connections were unified may carry an old role, and all of them count the same.
 * Trashed people and bookmarks drop out.
 */
export function connectionIndex(
	library: { list<T>(table: ReplicaTable): T[] } | null
): Map<string, Set<string>> {
	const index = new Map<string, Set<string>>();
	if (!library) return index;
	const live = (table: ReplicaTable) =>
		new Set(
			library
				.list<Row>(table)
				.filter((row) => !row.deletedAt && !row.purgedAt)
				.map((row) => String(row.id))
		);
	const people = live('people');
	const bookmarks = live('bookmarks');
	for (const row of library.list<Row>('relationships')) {
		const person = String(row.personId),
			bookmark = String(row.bookmarkId);
		if (row.deletedAt || !people.has(person) || !bookmarks.has(bookmark)) continue;
		const set = index.get(person) ?? new Set<string>();
		set.add(bookmark);
		index.set(person, set);
	}
	return index;
}
