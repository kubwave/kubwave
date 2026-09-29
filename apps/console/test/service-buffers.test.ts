import { describe, expect, test } from 'bun:test';
import { appendLiveSample, appendLogEntries, liveSeries, type LiveSample } from '../features/service/buffers';

const entry = (pod: string, timestamp: string, message: string) => ({ pod, timestamp, message });

describe('appendLogEntries', () => {
	test('appends only lines the overlapping tail has not delivered yet', () => {
		const first = appendLogEntries([], [entry('a', '1', 'boot'), entry('a', '2', 'ready')], 1000);
		const second = appendLogEntries(first, [entry('a', '2', 'ready'), entry('a', '3', 'GET /')], 1000);
		expect(second.map(line => line.message)).toEqual(['boot', 'ready', 'GET /']);
	});

	test('keeps the newest lines within the cap', () => {
		const lines = appendLogEntries([], [entry('a', '1', 'x'), entry('a', '2', 'y'), entry('a', '3', 'z')], 2);
		expect(lines.map(line => line.message)).toEqual(['y', 'z']);
	});
});

const metrics = (sampledAt: string, cpu: number, rx: number) => ({
	sampledAt,
	current: { cpuMillicores: cpu, memoryBytes: 100, networkRxBytes: rx, networkTxBytes: 0, volumes: [] }
});

describe('appendLiveSample', () => {
	test('adds a new kubelet sample and ignores a repeated one', () => {
		const once = appendLiveSample([], metrics('2026-09-01T00:00:10Z', 5, 0), 90);
		expect(appendLiveSample(once, metrics('2026-09-01T00:00:10Z', 5, 0), 90)).toBe(once);
		expect(appendLiveSample(once, metrics('2026-09-01T00:00:20Z', 7, 100), 90)).toHaveLength(2);
	});

	test('derives per-second network rates from the cumulative counters', () => {
		const samples: LiveSample[] = [
			{ t: 10, cpu: 5, mem: 1, rx: 0, tx: 0 },
			{ t: 20, cpu: 6, mem: 1, rx: 1000, tx: 500 }
		];
		const series = liveSeries(samples);
		expect(series.cpuMillicores).toEqual([
			{ t: 10, v: 5 },
			{ t: 20, v: 6 }
		]);
		expect(series.networkRxBytes.at(-1)?.v).toBe(100);
		expect(series.networkTxBytes.at(-1)?.v).toBe(50);
	});
});
