import { describe, expect, it } from 'vitest';
import { formatPersonLinks, parsePersonLinks } from '../../src/lib/domain/person-links.js';
import { searchLibrary } from '../../src/lib/client/search.js';
import { postTime } from '../../src/lib/client/workflows.js';

describe('person links field', () => {
	it('reads an @username, a website and more links', () => {
		const parsed = parsePersonLinks('@jack, jack.dev, github.com/jack, https://x.com/jack');
		expect(parsed.website).toBe('https://jack.dev/');
		expect(parsed.links).toEqual([
			{ platform: 'x', handle: 'jack', profileUrl: 'https://x.com/jack' },
			{ platform: 'github', handle: 'jack', profileUrl: 'https://github.com/jack' }
		]);
	});

	it('treats x.com and twitter.com profile URLs as X usernames', () => {
		expect(parsePersonLinks('twitter.com/Some_One').links[0]).toMatchObject({
			platform: 'x',
			handle: 'Some_One'
		});
		// Pages on x.com that are not accounts stay plain links.
		expect(parsePersonLinks('https://x.com/home').links[0]).toBeUndefined();
	});

	it('rejects invalid usernames and links', () => {
		expect(() => parsePersonLinks('@not-a-handle')).toThrow(/X username/);
		expect(() => parsePersonLinks('@waytoolongusername1')).toThrow();
		expect(() => parsePersonLinks('not a link')).toThrow();
	});

	it('round-trips through the edit form', () => {
		const parsed = parsePersonLinks('@jack, jack.dev, github.com/jack');
		expect(parsePersonLinks(formatPersonLinks(parsed.website, parsed.links))).toEqual(parsed);
	});
});

describe('@ search filter', () => {
	const jack = '20000000-0000-4000-8000-00000000000a';
	const jane = '20000000-0000-4000-8000-00000000000b';
	const tables: Record<string, Record<string, unknown>[]> = {
		people: [
			{ id: jack, kind: 'person', displayName: 'Jack Dorsey' },
			{ id: jane, kind: 'person', displayName: 'Jane Jacobs' },
			{ id: '20000000-0000-4000-8000-00000000000c', kind: 'person', displayName: 'Ada Lovelace' },
			{ id: '20000000-0000-4000-8000-00000000000d', kind: 'person', displayName: 'Ada Yonath' }
		],
		identities: [{ id: 'i1', personId: jack, platform: 'x', handle: 'jack', deletedAt: null }],
		bookmarks: [
			{ id: 'b1', title: 'By jack', createdAt: '2026-01-02' },
			{ id: 'b2', title: 'Mentions jane', createdAt: '2026-01-01' },
			{ id: 'b3', title: 'Unrelated', createdAt: '2026-01-03' }
		],
		relationships: [{ bookmarkId: 'b1', personId: jack, role: 'author' }],
		links: [{ sourceId: 'b2', edges: [{ targetId: jane, kind: 'reference' }] }]
	};
	const reader = {
		list: <T>(table: string): T[] => (tables[table] ?? []) as T[],
		get: <T>(table: string, key: string): T | undefined =>
			(tables[table] ?? []).find((row) => row.id === key) as T | undefined
	};
	const ids = (query: string) => searchLibrary(reader, 'all', query).items.map((r) => r.id);

	it('filters by X username, name and unique prefix', () => {
		expect(ids('@jack')).toEqual(['b1']);
		expect(ids('@JackDorsey')).toEqual(['b1']);
		expect(ids('@jane')).toEqual(['b2']);
		expect(ids('@jac')).toEqual(['b1']); // the handle "jack" is exact-prefix unique
	});

	it('explains unknown and ambiguous people', () => {
		expect(searchLibrary(reader, 'all', '@nobody').error).toMatch(/No person/);
		expect(searchLibrary(reader, 'all', '@ada').error).toMatch(/Several people/);
		// A handle prefix outranks people whose names merely start the same way.
		expect(ids('@ja')).toEqual(['b1']);
	});

	it('keeps the person themselves in the people view', () => {
		expect(searchLibrary(reader, 'people', '@jane').items.map((r) => r.id)).toEqual([jane]);
	});
});

describe('post time', () => {
	it('formats like a social feed', () => {
		const now = Date.parse('2026-10-27T12:00:00Z');
		expect(postTime('2026-10-27T11:59:30Z', now)).toBe('now');
		expect(postTime('2026-10-27T11:15:00Z', now)).toBe('45m');
		expect(postTime('2026-10-27T03:00:00Z', now)).toBe('9h');
		expect(postTime('2026-10-24T12:00:00Z', now)).toBe('3d');
		expect(postTime('2026-03-04T12:00:00Z', now)).not.toMatch(/2026/);
		expect(postTime('2025-03-04T12:00:00Z', now)).toMatch(/2025/);
	});
});
