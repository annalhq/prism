import { extractReferences } from '#lib/domain/notes.js';
import type { LibraryClient } from './vault/library.js';
type Row = Record<string, unknown>;

/** Cache Markdown parsing between local edits; neither sync status nor rendering reparses notes. */
export function createPeopleFeedIndex() {
	const cache = new Map<string, { body: string; refs: ReturnType<typeof extractReferences> }>();
	return (library: LibraryClient | null) => {
		const index = new Map<string, Map<string, string[]>>();
		if (!library) return index;
		const people = new Set(
			library
				.list<Row>('people')
				.filter((row) => !row.deletedAt && !row.purgedAt)
				.map((row) => String(row.id))
		);
		const bookmarks = new Set(
			library
				.list<Row>('bookmarks')
				.filter((row) => !row.deletedAt && !row.purgedAt)
				.map((row) => String(row.id))
		);
		const add = (person: string, bookmark: string, label: string) => {
			if (!people.has(person) || !bookmarks.has(bookmark)) return;
			const entries = index.get(person) ?? new Map<string, string[]>();
			const labels = entries.get(bookmark) ?? [];
			if (!labels.includes(label)) labels.push(label);
			entries.set(bookmark, labels);
			index.set(person, entries);
		};
		for (const row of library.list<Row>('relationships'))
			if (!row.deletedAt)
				add(
					String(row.personId),
					String(row.bookmarkId),
					row.role === 'author' ? 'Authored' : row.role === 'about' ? 'About' : 'Related'
				);
		const noteIds = new Set<string>();
		for (const note of library.list<Row>('notes')) {
			const id = String(note.entityId),
				body = String(note.bodyMarkdown);
			if (!bookmarks.has(id)) continue;
			noteIds.add(id);
			let parsed = cache.get(id);
			if (!parsed || parsed.body !== body) {
				parsed = { body, refs: extractReferences(body) };
				cache.set(id, parsed);
			}
			for (const ref of parsed.refs) if (ref.kind === 'person') add(ref.id, id, 'Mentioned');
		}
		for (const id of cache.keys()) if (!noteIds.has(id)) cache.delete(id);
		// Related edges are explicit links. Note references use the optimistic note above,
		// rather than stale confirmed link edges while a note edit is queued.
		for (const row of library.list<Row>('links'))
			for (const edge of (row.edges as { targetId: string; kind: string }[]) ?? [])
				if (edge.kind === 'related') add(edge.targetId, String(row.sourceId), 'Related');
		return index;
	};
}
