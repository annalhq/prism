import type { BookmarkProjection, NoteProjection } from '../../src/lib/domain/contracts.js';
import type { PersonIdentityProjection, PersonProjection } from '../../src/lib/domain/people.js';
import type { ContentPersonProjection } from '../../src/lib/domain/relationships.js';
import type { SearchFilter } from '../../src/lib/domain/search.js';

// Synthetic portability fixture: same-named people stay distinct; references in
// notes, identities, roles and saved filters must all survive import ID remapping.
const id = (suffix: number) => `019a0000-0000-7000-8000-${String(suffix).padStart(12, '0')}`;
const at = '2026-10-16T00:00:00.000Z';
const metadata = {
	revision: '1' as const,
	lastSeq: '1' as const,
	createdAt: at,
	updatedAt: at,
	deletedAt: null
};
const person = (suffix: number): PersonProjection => ({
	...metadata,
	id: id(suffix),
	kind: 'person',
	displayName: 'Ada',
	bio: 'A distinct individual.',
	website: null,
	purgedAt: null,
	tagIds: []
});
export const knowledgePeopleFixture = {
	version: 1,
	people: [person(1), person(2)],
	bookmarks: [
		{
			...metadata,
			id: id(10),
			kind: 'social',
			title: 'Saved post',
			description: '',
			url: 'https://x.com/example/status/42',
			canonicalUrl: 'https://x.com/example/status/42',
			domain: 'x.com',
			collectionId: null,
			readingStatus: 'unread',
			isPinned: false,
			archivedAt: null,
			tagIds: []
		}
	],
	identities: [1, 2].map((suffix): PersonIdentityProjection => ({
		...metadata,
		id: id(20 + suffix),
		personId: id(suffix),
		platform: 'x',
		nativeAccountId: String(suffix),
		profileUrl: `https://x.com/individual${suffix}`,
		handle: 'a-shared-unverified-label'
	})),
	relationships: [
		{ ...metadata, bookmarkId: id(10), personId: id(1), role: 'author', provenance: 'manual' },
		{
			...metadata,
			bookmarkId: id(10),
			personId: id(1),
			role: 'about',
			provenance: 'capture_confirmed'
		}
	],
	notes: [
		{
			entityId: id(10),
			bodyMarkdown: `Mention only: [Ada](prism:person/${id(2)}).`,
			revision: '1',
			lastSeq: '2',
			createdAt: at,
			updatedAt: at
		},
		{
			entityId: id(1),
			bodyMarkdown: `[Saved work](prism:bookmark/${id(10)}).`,
			revision: '1',
			lastSeq: '3',
			createdAt: at,
			updatedAt: at
		}
	],
	filter: {
		version: 1,
		scope: 'active',
		text: [],
		tags: [],
		kinds: ['social'],
		people: [{ id: id(1), label: 'Ada', role: 'author' }],
		personas: [],
		statuses: [],
		has: []
	}
} satisfies {
	version: 1;
	people: PersonProjection[];
	bookmarks: BookmarkProjection[];
	identities: PersonIdentityProjection[];
	relationships: ContentPersonProjection[];
	notes: NoteProjection[];
	filter: SearchFilter;
};
