import { describe, expect, test } from 'bun:test';
import { parseAnsi, stripAnsi } from '../app/utils/ansi';

const ESC = String.fromCharCode(27);

describe('stripAnsi', () => {
	test('removes SGR color codes, keeping the visible text', () => {
		expect(stripAnsi(`${ESC}[36mINFO${ESC}[0m[0000] Retrieving image manifest`)).toBe('INFO[0000] Retrieving image manifest');
	});

	test('leaves plain text untouched', () => {
		expect(stripAnsi('no escapes here')).toBe('no escapes here');
	});
});

describe('parseAnsi', () => {
	test('returns a single uncolored segment for plain text', () => {
		expect(parseAnsi('just text')).toEqual([{ text: 'just text', classes: '' }]);
	});

	test('returns no segments for an empty line', () => {
		expect(parseAnsi('')).toEqual([]);
	});

	test('colors a cyan INFO prefix and leaves the rest default', () => {
		expect(parseAnsi(`${ESC}[36mINFO${ESC}[0m rest`)).toEqual([
			{ text: 'INFO', classes: 'text-cyan-400' },
			{ text: ' rest', classes: '' }
		]);
	});

	test('maps red to an error color', () => {
		expect(parseAnsi(`${ESC}[31mERROR${ESC}[0m`)).toEqual([{ text: 'ERROR', classes: 'text-red-400' }]);
	});

	test('combines bold with a color in one segment', () => {
		expect(parseAnsi(`${ESC}[1;36mX${ESC}[0m`)).toEqual([{ text: 'X', classes: 'text-cyan-400 font-bold' }]);
	});

	test('ignores unsupported codes (e.g. background) without dropping text', () => {
		expect(parseAnsi(`${ESC}[40mbg${ESC}[0m`)).toEqual([{ text: 'bg', classes: '' }]);
	});

	test('does not emit an empty trailing segment after a reset', () => {
		expect(parseAnsi(`${ESC}[32mdone${ESC}[0m`)).toEqual([{ text: 'done', classes: 'text-emerald-400' }]);
	});
});
