import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModal, keyOf, parseKeys, type Mode } from '../../src/lib/client/vim.js';

function setup() {
	const log: string[] = [];
	const modes: [Mode, Mode][] = [];
	const machine = createModal(
		{
			normal: {
				j: (n) => void log.push(`j${n ?? ''}`),
				gg: (n) => void log.push(`gg${n ?? ''}`),
				dd: (n) => void log.push(`dd${n ?? ''}`),
				v: () => 'visual',
				'<C-d>': () => void log.push('half'),
				'<Space>': () => false
			},
			visual: {
				j: () => void log.push('vj'),
				v: () => 'normal',
				d: () => {
					log.push('vd');
					return 'normal';
				}
			}
		},
		{ timeout: 1000, onMode: (next, previous) => modes.push([next, previous]) }
	);
	return { machine, log, modes };
}

describe('modal keys', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('enters visual with v and leaves with Escape, not only v', () => {
		const { machine, modes } = setup();
		machine.feed('v');
		expect(machine.mode()).toBe('visual');
		expect(machine.feed('<Esc>')).toBe(true);
		expect(machine.mode()).toBe('normal');
		expect(modes).toEqual([
			['visual', 'normal'],
			['normal', 'visual']
		]);
	});

	it('passes Escape through in a clean normal mode', () => {
		const { machine } = setup();
		expect(machine.feed('<Esc>')).toBe(false);
	});

	it('uses each mode’s own keymap', () => {
		const { machine, log } = setup();
		machine.feed('j');
		machine.feed('v');
		machine.feed('j');
		machine.feed('d');
		expect(log).toEqual(['j', 'vj', 'vd']);
		expect(machine.mode()).toBe('normal');
	});

	it('resolves sequences and counts', () => {
		const { machine, log } = setup();
		for (const key of ['3', 'j', 'g', 'g', '1', '2', 'g', 'g', '2', 'd', 'd']) machine.feed(key);
		expect(log).toEqual(['j3', 'gg', 'gg12', 'dd2']);
	});

	it('Escape cancels a pending sequence before it changes mode', () => {
		const { machine, log } = setup();
		machine.feed('v');
		machine.feed('3');
		expect(machine.feed('<Esc>')).toBe(true);
		expect(machine.mode()).toBe('visual');
		machine.feed('<Esc>');
		expect(machine.mode()).toBe('normal');
		expect(log).toEqual([]);
	});

	it('abandons an unknown sequence and swallows its key', () => {
		const { machine, log } = setup();
		machine.feed('d');
		expect(machine.feed('j')).toBe(true);
		expect(log).toEqual([]);
		machine.feed('j');
		expect(log).toEqual(['j']);
	});

	it('drops a pending prefix after the timeout', () => {
		const { machine, log } = setup();
		machine.feed('g');
		vi.advanceTimersByTime(1000);
		machine.feed('g');
		expect(log).toEqual([]);
	});

	it('lets unbound keys and declined handlers through', () => {
		const { machine } = setup();
		expect(machine.feed('/')).toBe(false);
		expect(machine.feed('<Space>')).toBe(false);
	});

	it('names keys in Vim notation', () => {
		expect(keyOf({ key: 'd', ctrlKey: true })).toBe('<C-d>');
		expect(keyOf({ key: 'ArrowDown', ctrlKey: false })).toBe('<Down>');
		expect(keyOf({ key: 'G', ctrlKey: false })).toBe('G');
		expect(keyOf({ key: 'Shift', ctrlKey: false })).toBeNull();
		expect(parseKeys('g<C-d><')).toEqual(['g', '<C-d>', '<']);
	});
});
