import { describe, expect, test } from 'bun:test';
import { mergeAndSortEntries, parsePodLog } from '~/modules/services/logs/logs.parse';

describe('parsePodLog', () => {
	test('splits the RFC3339 timestamp prefix (timestamps:true) from the message', () => {
		const raw = '2026-06-07T10:11:12.345678901Z hello world\n2026-06-07T10:11:13Z second line\n';
		expect(parsePodLog(raw, 'pod-a')).toEqual([
			{ pod: 'pod-a', timestamp: '2026-06-07T10:11:12.345678901Z', message: 'hello world' },
			{ pod: 'pod-a', timestamp: '2026-06-07T10:11:13Z', message: 'second line' }
		]);
	});

	test('lines without a valid timestamp keep the whole line as the message', () => {
		const raw = 'no timestamp here\nFooBar starting up\n';
		expect(parsePodLog(raw, 'pod-a')).toEqual([
			{ pod: 'pod-a', timestamp: null, message: 'no timestamp here' },
			{ pod: 'pod-a', timestamp: null, message: 'FooBar starting up' }
		]);
	});

	test('empty blob and trailing newline produce no spurious entries', () => {
		expect(parsePodLog('', 'pod-a')).toEqual([]);
		expect(parsePodLog('2026-06-07T10:11:12Z only line\n', 'pod-a')).toHaveLength(1);
	});

	test('preserves an empty message after the timestamp', () => {
		expect(parsePodLog('2026-06-07T10:11:12Z ', 'pod-a')).toEqual([{ pod: 'pod-a', timestamp: '2026-06-07T10:11:12Z', message: '' }]);
	});
});

describe('mergeAndSortEntries', () => {
	test('interleaves entries from multiple pods chronologically', () => {
		const a = parsePodLog('2026-06-07T10:00:00Z a1\n2026-06-07T10:00:02Z a2\n', 'pod-a');
		const b = parsePodLog('2026-06-07T10:00:01Z b1\n2026-06-07T10:00:03Z b2\n', 'pod-b');
		expect(mergeAndSortEntries([a, b]).map(e => e.message)).toEqual(['a1', 'b1', 'a2', 'b2']);
	});

	test('untimed lines sort to the end, preserving their relative order', () => {
		const merged = mergeAndSortEntries([
			[
				{ pod: 'p', timestamp: null, message: 'untimed-1' },
				{ pod: 'p', timestamp: '2026-06-07T10:00:00Z', message: 'timed' },
				{ pod: 'p', timestamp: null, message: 'untimed-2' }
			]
		]);
		expect(merged.map(e => e.message)).toEqual(['timed', 'untimed-1', 'untimed-2']);
	});
});
