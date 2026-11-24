import { describe, expect, it } from 'vitest';
import { resolveSpaceId, shelfFor } from '../../src/lib/client/spaces.svelte.js';

const home = { id: 'home', name: 'Home', isDefault: true };
const work = { id: 'work', name: 'Work' };
const spaces = [work, home];
const clients = { id: 'clients', name: 'Clients', spaceId: 'work' };
const folders = [clients];
const acme = { id: 'acme', name: 'acme', folderId: 'clients' };
const design = { id: 'design', name: 'design', spaceId: 'work' };
const loose = { id: 'loose', name: 'loose' };
const stray = { id: 'stray', name: 'stray', spaceId: 'gone' };
const tags = [acme, design, loose, stray];

describe('spaces', () => {
	it('shows the remembered space while it exists, else the default', () => {
		expect(resolveSpaceId(spaces, 'work')).toBe('work');
		expect(resolveSpaceId(spaces, 'deleted')).toBe('home');
		expect(resolveSpaceId(spaces, '')).toBe('home');
		expect(resolveSpaceId([work], '')).toBe('work');
		expect(resolveSpaceId([], 'work')).toBe('');
	});

	it('puts a tag where its folder goes, and unplaced tags in the default space', () => {
		const shelf = shelfFor('work', tags, folders, spaces);
		expect(shelf.groups.map((g) => g.folder.id)).toEqual(['clients']);
		expect(shelf.groups[0].tags.map((t) => t.id)).toEqual(['acme']);
		expect(shelf.loose.map((t) => t.id)).toEqual(['design']);
		const fallback = shelfFor('home', tags, folders, spaces);
		expect(fallback.groups).toEqual([]);
		expect(fallback.loose.map((t) => t.id)).toEqual(['loose', 'stray']);
	});

	it('gives an empty shelf for a space with nothing in it', () => {
		const shelf = shelfFor('empty', tags, folders, [...spaces, { id: 'empty', name: 'Empty' }]);
		expect(shelf).toEqual({ groups: [], loose: [] });
	});
});
