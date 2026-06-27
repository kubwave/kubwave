import { describe, expect, test } from 'bun:test';
import { pollIntervalForRange, fractionalX, seriesDomain, deployMarkers, nearestIndex, deriveRateSeries } from '../app/utils/metrics-chart';

describe('pollIntervalForRange', () => {
	test('refreshes 1h often, 24h slowly, and never auto-refreshes 7d', () => {
		expect(pollIntervalForRange('1h')).toBe(30_000);
		expect(pollIntervalForRange('24h')).toBe(300_000);
		// react-query treats `false` as "do not poll" — the 7d window barely moves.
		expect(pollIntervalForRange('7d')).toBe(false);
	});
});

describe('fractionalX', () => {
	test('maps a timestamp to its 0..1 position in the domain', () => {
		expect(fractionalX(50, 0, 100)).toBe(0.5);
	});

	test('clamps outside the domain so markers never escape the chart', () => {
		expect(fractionalX(-10, 0, 100)).toBe(0);
		expect(fractionalX(200, 0, 100)).toBe(1);
	});

	test('a zero-width domain (single live point) pins to 0 instead of dividing by zero', () => {
		expect(fractionalX(10, 10, 10)).toBe(0);
	});
});

describe('seriesDomain', () => {
	test('spans the first and last point times', () => {
		expect(
			seriesDomain([
				{ t: 100, v: 1 },
				{ t: 130, v: 2 },
				{ t: 160, v: 3 }
			])
		).toEqual({ start: 100, end: 160 });
	});

	test('empty series has no domain', () => {
		expect(seriesDomain([])).toBeNull();
	});
});

describe('deployMarkers', () => {
	const start = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000);
	const end = start + 3600;
	const domain = { start, end };

	test('keeps only deploys inside the window, positioned fractionally, carrying the deploy id', () => {
		const markers = deployMarkers(
			[
				{ id: 'dep-mid', createdAt: '2026-01-01T00:30:00.000Z', status: 'succeeded' }, // midpoint
				{ id: 'dep-before', createdAt: '2025-12-31T23:00:00.000Z', status: 'failed' }, // before window
				{ id: 'dep-after', createdAt: '2026-01-01T02:00:00.000Z', status: 'failed' } // after window
			],
			domain
		);
		expect(markers).toHaveLength(1);
		expect(markers[0]!.id).toBe('dep-mid');
		expect(markers[0]!.status).toBe('succeeded');
		expect(markers[0]!.x).toBeCloseTo(0.5, 5);
	});

	test('no domain (empty/live series) yields no markers', () => {
		expect(deployMarkers([{ id: 'd1', createdAt: '2026-01-01T00:30:00.000Z', status: 'succeeded' }], null)).toEqual([]);
	});
});

describe('nearestIndex', () => {
	const points = [
		{ t: 0, v: 1 },
		{ t: 100, v: 2 },
		{ t: 200, v: 3 }
	];

	test('maps a fractional x to the closest point by time', () => {
		expect(nearestIndex(points, 0)).toBe(0);
		expect(nearestIndex(points, 1)).toBe(2);
		expect(nearestIndex(points, 0.4)).toBe(1); // targetT 80 → closest is t=100
		expect(nearestIndex(points, 0.9)).toBe(2); // targetT 180 → closest is t=200
	});

	test('empty series has no nearest index', () => {
		expect(nearestIndex([], 0.5)).toBe(-1);
	});
});

describe('deriveRateSeries', () => {
	test('turns cumulative counters into per-second rates stamped at the later sample', () => {
		const rates = deriveRateSeries([
			{ t: 100, v: 0 },
			{ t: 110, v: 100 },
			{ t: 120, v: 300 }
		]);
		expect(rates).toEqual([
			{ t: 110, v: 10 },
			{ t: 120, v: 20 }
		]);
	});

	test('clamps a counter reset (negative delta) to 0', () => {
		expect(
			deriveRateSeries([
				{ t: 100, v: 500 },
				{ t: 110, v: 100 }
			])
		).toEqual([{ t: 110, v: 0 }]);
	});

	test('fewer than two samples → no rates', () => {
		expect(deriveRateSeries([{ t: 100, v: 5 }])).toEqual([]);
		expect(deriveRateSeries([])).toEqual([]);
	});
});
