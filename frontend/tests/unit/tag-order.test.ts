import { describe, expect, it } from 'vitest';
import {
	parseOrganizationCommand,
	positionBetween,
	sortByPosition,
	spreadPositions,
	TAG_POSITION_PATTERN
} from '../../src/lib/domain/organization.js';

describe('tag positions', () => {
	it('finds a valid key strictly between two keys', () => {
		const pairs: [string | null, string | null][] = [
			[null, null],
			[null, 'i'],
			['i', null],
			['i', 'j'],
			['a', 'a1'],
			['zz', null],
			['0z', '1']
		];
		for (const [a, b] of pairs) {
			const key = positionBetween(a, b);
			expect(key).toMatch(TAG_POSITION_PATTERN);
			if (a !== null) expect(key > a).toBe(true);
			if (b !== null) expect(key < b).toBe(true);
		}
	});

	it('keeps keys short when repeatedly inserting at one spot', () => {
		let low = 'a',
			high = 'b';
		for (let i = 0; i < 200; i++) {
			const key = positionBetween(low, high);
			expect(key > low && key < high).toBe(true);
			if (i % 2) low = key;
			else high = key;
		}
		expect(low.length).toBeLessThan(128);
	});

	it('spreads ascending valid keys for a whole list', () => {
		for (const count of [1, 2, 35, 36, 100, 2000]) {
			const keys = spreadPositions(count);
			expect(keys).toHaveLength(count);
			for (const key of keys) expect(key).toMatch(TAG_POSITION_PATTERN);
			for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
		}
	});

	it('orders positioned tags first and keeps the rest in place', () => {
		const rows = [
			{ id: 'a', position: null },
			{ id: 'b', position: 'm' },
			{ id: 'c' },
			{ id: 'd', position: 'c' }
		];
		expect(sortByPosition(rows).map((r) => r.id)).toEqual(['d', 'b', 'a', 'c']);
	});

	it('validates tag.move commands', () => {
		const id = '00000000-0000-4000-8000-000000000001';
		expect(
			parseOrganizationCommand({ type: 'tag.move', id, expectedRevision: '3', position: 'i' })
		).toEqual({ type: 'tag.move', id, expectedRevision: '3', position: 'i' });
		for (const position of ['', 'i0', 'I', 'a-b', 7])
			expect(() =>
				parseOrganizationCommand({ type: 'tag.move', id, expectedRevision: '3', position })
			).toThrow();
	});
});
