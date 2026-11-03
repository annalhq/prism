import type { ReplicaRecord, ReplicaTable } from '../../src/lib/domain/replica.js';

// Deterministic synthetic libraries for load-path measurements (scripts/performance-library.mjs).
// Content is generated, never copied from a real vault. The same size always yields the same
// records, so before/after comparisons replay identical bootstrap payloads.

export const PERFORMANCE_SIZES = { empty: 0, medium: 500, large: 5_000 } as const;
export type PerformanceSize = keyof typeof PERFORMANCE_SIZES;

const VAULT_ID = '019a0000-0000-7000-8000-00000000f00d';
export const PERFORMANCE_IDENTITY = Object.freeze({
	subject: 'performance-fixture-owner',
	vaultId: VAULT_ID
});

const uuid = (namespace: number, index: number) =>
	`019a${namespace.toString(16).padStart(4, '0')}-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
const epoch = Date.parse('2026-01-01T00:00:00.000Z');
const at = (index: number) => new Date(epoch + index * 60_000).toISOString();

// Small deterministic PRNG (mulberry32) so fixture shape does not depend on Math.random.
function random(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const words = (
	'signal latency replica cursor lattice harbor ember quartz meadow orbit cinder vector ' +
	'prism atlas fable tundra copper willow lantern summit delta glyph thistle beacon'
).split(' ');

export function performanceLibrary(size: PerformanceSize): ReplicaRecord[] {
	const count = PERFORMANCE_SIZES[size];
	const next = random(count + 1);
	const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)];
	const phrase = (length: number) => Array.from({ length }, () => pick(words)).join(' ');
	let seq = 0;
	const records: ReplicaRecord[] = [];
	const push = (table: ReplicaTable, key: string, value: Record<string, unknown>) =>
		records.push({ table, key, lastSeq: String(value.lastSeq) as ReplicaRecord['lastSeq'], value });
	const meta = (index: number) => {
		const lastSeq = String(++seq);
		return {
			revision: '1',
			lastSeq,
			createdAt: at(index),
			updatedAt: at(index),
			deletedAt: null
		};
	};
	if (!count) return records;

	const tagCount = Math.max(5, Math.round(count / 25));
	const peopleCount = Math.max(3, Math.round(count / 20));
	const tagIds = Array.from({ length: tagCount }, (_, index) => uuid(1, index));
	const personIds = Array.from({ length: peopleCount }, (_, index) => uuid(2, index));

	tagIds.forEach((id, index) => {
		const name = `${pick(words)}-${index}`;
		push('tags', id, { id, name, normalizedName: name, position: null, ...meta(index) });
	});
	personIds.forEach((id, index) => {
		const value = {
			id,
			kind: 'person',
			displayName: `Person ${index}`,
			bio: phrase(8),
			website: null,
			purgedAt: null,
			tagIds: [],
			...meta(index)
		};
		push('entities', id, {
			id,
			kind: 'person',
			tagIds: [],
			revision: value.revision,
			lastSeq: value.lastSeq,
			deletedAt: null,
			purgedAt: null,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt
		});
		push('people', id, value);
	});

	for (let index = 0; index < count; index++) {
		const id = uuid(3, index);
		// Roughly one in twenty-five items is a rabbit-hole stash with a nested Markdown trail.
		const stash = index % 25 === 7;
		const host = `${pick(words)}.example`;
		const url = stash ? null : `https://${host}/${pick(words)}/${index}`;
		const tags = [...new Set([pick(tagIds), pick(tagIds)])].slice(0, 1 + (index % 2));
		const fields = meta(index);
		push('entities', id, {
			id,
			kind: 'bookmark',
			tagIds: tags,
			revision: fields.revision,
			lastSeq: fields.lastSeq,
			deletedAt: null,
			purgedAt: null,
			createdAt: fields.createdAt,
			updatedAt: fields.updatedAt
		});
		push('bookmarks', id, {
			id,
			kind: stash ? 'stash' : index % 9 === 4 ? 'social' : 'page',
			title: `${phrase(4)} ${index}`,
			description: phrase(14),
			url,
			canonicalUrl: url,
			domain: stash ? null : host,
			collectionId: null,
			readingStatus: pick(['unread', 'reading', 'read'] as const),
			isPinned: index % 97 === 0,
			archivedAt: null,
			tagIds: tags,
			...fields
		});
		// About a third of items carry a note; some link to a person via a typed Prism link.
		if (stash || index % 3 === 0) {
			const person = pick(personIds);
			const body = stash
				? [
						`- [${phrase(3)}](https://${host}/start) — ${phrase(6)}`,
						`  - [${phrase(3)}](https://${host}/next) — ${phrase(5)}`,
						`    - [${phrase(2)}](https://${host}/deeper) — ${phrase(4)}`,
						`- [${phrase(3)}](https://${host}/aside) — ${phrase(6)}`
					].join('\n')
				: `## ${phrase(3)}\n\n${phrase(40)}\n\n- ${phrase(6)}\n- ${phrase(5)}\n\nSee [Person](prism:person/${person}) and \`${pick(words)}\`.`;
			const note = meta(index);
			push('notes', id, {
				entityId: id,
				bodyMarkdown: body,
				revision: note.revision,
				lastSeq: note.lastSeq,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt
			});
			push('links', id, {
				sourceId: id,
				lastSeq: note.lastSeq,
				edges: stash ? [] : [{ targetId: person, kind: 'note_reference' }]
			});
		}
		if (index % 4 === 0) {
			const personId = pick(personIds);
			const role = index % 8 === 0 ? 'author' : 'about';
			push('relationships', `${id}/${personId}/${role}`, {
				bookmarkId: id,
				personId,
				role,
				provenance: 'manual',
				...meta(index)
			});
		}
	}
	return records;
}

/** Final sequence of a fixture, used as the bootstrap start and change-feed position. */
export function performanceSequence(records: readonly ReplicaRecord[]): string {
	return records.reduce((max, row) => (BigInt(row.lastSeq) > BigInt(max) ? row.lastSeq : max), '0');
}
