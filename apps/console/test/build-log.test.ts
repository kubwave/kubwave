import { describe, expect, test } from 'bun:test';
import { buildLogLines } from '../app/utils/build-log';

const ESC = String.fromCharCode(27);

describe('buildLogLines', () => {
	test('orders containers prepare → nixpacks → builder regardless of input order', () => {
		const lines = buildLogLines([
			{ containerName: 'builder', content: 'k' },
			{ containerName: 'prepare', content: 'p' },
			{ containerName: 'nixpacks', content: 'n' }
		]);
		expect(lines.map(line => line.container)).toEqual(['prepare', 'nixpacks', 'builder']);
	});

	test('a single container produces no dividers and splits content into lines', () => {
		const lines = buildLogLines([{ containerName: 'builder', content: 'a\nb' }]);
		expect(lines.map(line => line.showDivider)).toEqual([false, false]);
		expect(lines.map(line => line.segments.map(seg => seg.text).join(''))).toEqual(['a', 'b']);
	});

	test('marks a divider on the first line of each phase when multiple containers', () => {
		const lines = buildLogLines([
			{ containerName: 'prepare', content: 'clone' },
			{ containerName: 'builder', content: 'l1\nl2' }
		]);
		expect(lines.map(line => ({ container: line.container, divider: line.showDivider }))).toEqual([
			{ container: 'prepare', divider: true },
			{ container: 'builder', divider: true },
			{ container: 'builder', divider: false }
		]);
	});

	test('parses ANSI within each line into colored segments', () => {
		const lines = buildLogLines([{ containerName: 'builder', content: `${ESC}[36mINFO${ESC}[0m done` }]);
		expect(lines[0]!.segments).toEqual([
			{ text: 'INFO', classes: 'text-cyan-400' },
			{ text: ' done', classes: '' }
		]);
	});
});
