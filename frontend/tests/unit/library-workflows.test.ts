import { describe, expect, it } from 'vitest';
import {
	inferBookmarkKind,
	isReadLater,
	personIdFromSlug,
	personSlug,
	tagIdFromSlug,
	tagNames,
	tagSlug
} from '../../src/lib/client/workflows.js';
import {
	removeNoteReference,
	addNoteLink,
	splitLinkedNote,
	joinLinkedNote,
	removeLinkedNoteReference,
	notePreview
} from '../../src/lib/client/reference-edits.js';
import { searchLibrary } from '../../src/lib/client/search.js';
const id = '20000000-0000-4000-8000-000000000001';
describe('minimal library workflows', () => {
	it('infers Twitter/X content by hostname and rejects lookalikes', () => {
		for (const url of [
			'https://x.com/a/status/1',
			'https://twitter.com/a/status/2',
			'https://mobile.twitter.com/a/status/3'
		])
			expect(inferBookmarkKind(url)).toBe('social');
		for (const url of [
			'https://x.com.evil.test/a',
			'https://example.com/twitter.com',
			'https://example.com/?url=https://x.com'
		])
			expect(inferBookmarkKind(url)).toBe('page');
		expect(() => inferBookmarkKind('javascript:alert(1)')).toThrow();
	});
	it('keeps new unread bookmarks outside Read later until explicitly saved', () => {
		expect(isReadLater({ readingStatus: 'unread' })).toBe(false);
		expect(isReadLater({ readingStatus: 'reading' })).toBe(true);
		const rows = [
			{ id: 'a', readingStatus: 'unread' },
			{ id: 'b', readingStatus: 'reading' },
			{ id: 'c', readingStatus: 'read' }
		];
		const reader = {
			list: <T>(table: string): T[] => (table === 'bookmarks' ? rows : []) as T[],
			get: <T>(): T | undefined => undefined
		};
		expect(searchLibrary(reader, 'later', '').items.map((r) => r.id)).toEqual(['b']);
	});
	it('normalizes hash and comma-separated tags without duplicate case variants', () => {
		expect(tagNames(' #Design, systems, design, , #New Ideas ')).toEqual([
			'design',
			'systems',
			'New Ideas'
		]);
	});
	it('uses stable profile identity despite duplicate names or renamed slug prefixes', () => {
		const slug = personSlug({ displayName: 'Ann Example', id });
		expect(slug).toBe(`ann-example--${id}`);
		expect(personIdFromSlug(slug)).toBe(id);
		expect(personIdFromSlug(`old-name--${id}`)).toBe(id);
		expect(personIdFromSlug('not-a-person')).toBeNull();
	});
	it('removes only actual note references and preserves code and other links', () => {
		const ref = `prism:bookmark/${id}`;
		const input = `[Real](${ref})\n\n\`[Code](${ref})\`\n\n[External](https://example.com)`;
		expect(removeNoteReference(input, `bookmark/${id}`)).toBe(
			`Real\n\n\`[Code](${ref})\`\n\n[External](https://example.com)`
		);
	});
	it('also removes definition-style references without deleting their label', () => {
		expect(
			removeNoteReference(`[Name][a]\n\n[a]: prism:bookmark/${id}`, `bookmark/${id}`)
		).toContain('Name\n\n[a]:');
	});
});

describe('plain notes with separate linked items', () => {
	it('round trips note text and searchable reference metadata without showing IDs', () => {
		const text = 'A plain thought.\n';
		const body = addNoteLink(text, { kind: 'bookmark', id }, 'A [linked] idea');
		expect(splitLinkedNote(body).text).toBe(text);
		expect(splitLinkedNote(body).links[0].label).toBe('A [linked] idea');
		expect(notePreview(body)).toBe(text);
		expect(joinLinkedNote(splitLinkedNote(body).text, splitLinkedNote(body).links)).toBe(body);
		expect(removeLinkedNoteReference(body, `bookmark/${id}`)).toBe(text);
	});
	it('never treats markers inside code as generated reference metadata', () => {
		const text =
			'```\n<!-- prism:links:v1 -->\n\n[Name](prism:bookmark/' +
			id +
			')\n\n<!-- /prism:links:v1 -->';
		expect(splitLinkedNote(text)).toEqual({ text, links: [] });
	});
});

describe('tag slugs', () => {
	const a = '6f539c29-50c3-4d48-9c2b-e7ccf34b54d9';
	const b = '7a539c29-50c3-4d48-9c2b-e7ccf34b54d9';
	const c = '8b539c29-50c3-4d48-9c2b-e7ccf34b54d9';
	const tags = [
		{ id: a, name: 'Machine Learning' },
		{ id: b, name: 'C++' },
		{ id: c, name: 'C#' }
	];
	it('uses the name alone when it is unique', () => {
		expect(tagSlug(tags[0], tags)).toBe('machine-learning');
		expect(tagIdFromSlug('machine-learning', tags)).toBe(a);
		expect(tagIdFromSlug('Machine-Learning', tags)).toBe(a);
	});
	it('adds the id when names collide', () => {
		expect(tagSlug(tags[1], tags)).toBe(`c--${b}`);
		expect(tagIdFromSlug(`c--${b}`, tags)).toBe(b);
		expect(tagIdFromSlug('c', tags)).toBeNull();
	});
	it('accepts a bare id and rejects unknown names', () => {
		expect(tagIdFromSlug(a, tags)).toBe(a);
		expect(tagIdFromSlug('nope', tags)).toBeNull();
	});
});
