import type { MetricsRange, PrometheusMetricPoint, PromMatrixResult, RangeSpec } from './prometheus.types.js';

export const RANGES: Record<MetricsRange, RangeSpec> = {
	'1h': { windowSeconds: 3600, stepSeconds: 10, rateWindow: '1m' },
	'24h': { windowSeconds: 86_400, stepSeconds: 600, rateWindow: '30m' },
	'7d': { windowSeconds: 604_800, stepSeconds: 900, rateWindow: '30m' }
};

export function pointsOf(result: PromMatrixResult[] | undefined): PrometheusMetricPoint[] {
	const series = result?.[0];
	if (!series) return [];
	return series.values.map(([t, v]) => ({ t, v: Number(v) })).filter(point => Number.isFinite(point.v));
}

export function lastValue(points: PrometheusMetricPoint[]): number {
	return points.length > 0 ? points[points.length - 1]!.v : 0;
}

export async function queryRange(baseUrl: string, query: string, start: number, end: number, step: number): Promise<PromMatrixResult[]> {
	const url = new URL('/api/v1/query_range', baseUrl);
	url.searchParams.set('query', query);
	url.searchParams.set('start', String(start));
	url.searchParams.set('end', String(end));
	url.searchParams.set('step', String(step));

	const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
	if (!response.ok) throw new Error(`Prometheus query failed: ${response.status}`);

	const body = (await response.json()) as { status?: string; data?: { result?: PromMatrixResult[] } };
	if (body.status !== 'success') throw new Error('Prometheus query returned non-success status');

	return body.data?.result ?? [];
}
