import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MetricsConfigService } from '~/shared/metrics/metrics-config.service';

mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

const { ClusterUsageService } = await import('~/modules/platform/cluster/cluster-usage.service');

const realFetch = globalThis.fetch;

let queries: string[] = [];
let matrix: Record<string, Array<[number, string]>> = {};
let fetchRejects = false;

function stubFetch() {
	globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
		if (fetchRejects) throw new Error('prometheus down');
		const url = new URL(String(input));
		const query = url.searchParams.get('query') ?? '';
		queries.push(query);
		const values = query.includes('cpu') ? (matrix.cpu ?? []) : (matrix.memory ?? []);

		return new Response(JSON.stringify({ status: 'success', data: { result: values.length > 0 ? [{ metric: {}, values }] : [] } }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}) as typeof fetch;
}

function makeService(prometheusUrl: string | null) {
	const metricsConfig = {
		getMetricsProviderSettings: async () => ({ provider: prometheusUrl ? 'prometheus-managed' : 'live', prometheusUrl }),
		resolvePrometheusUrl: () => prometheusUrl
	} as unknown as MetricsConfigService;
	return new ClusterUsageService(metricsConfig);
}

beforeEach(() => {
	queries = [];
	matrix = { cpu: [[1000, '250']], memory: [[1000, '1048576']] };
	fetchRejects = false;
	stubFetch();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('ClusterUsageService', () => {
	test('maps a matrix result into both series', async () => {
		const usage = await makeService('http://prometheus:9090').getUsage('1h');
		expect(usage.available).toBe(true);
		expect(usage.range).toBe('1h');
		expect(usage.series.cpuMillicores).toEqual([{ t: 1000, v: 250 }]);
		expect(usage.series.memoryBytes).toEqual([{ t: 1000, v: 1_048_576 }]);
	});

	test('queries container sums for cpu and memory', async () => {
		await makeService('http://prometheus:9090').getUsage('24h');
		expect(queries).toHaveLength(2);
		expect(queries[0]).toContain('container_cpu_usage_seconds_total');
		expect(queries[0]).toContain('[30m]');
		expect(queries[1]).toContain('container_memory_working_set_bytes');
	});

	test('is unavailable when both series are empty', async () => {
		matrix = { cpu: [], memory: [] };
		const usage = await makeService('http://prometheus:9090').getUsage('1h');
		expect(usage.available).toBe(false);
	});

	test('skips prometheus entirely when no url resolves', async () => {
		const usage = await makeService(null).getUsage('1h');
		expect(usage.available).toBe(false);
		expect(usage.series).toEqual({ cpuMillicores: [], memoryBytes: [] });
		expect(queries).toEqual([]);
	});

	test('returns unavailable when the query fails', async () => {
		fetchRejects = true;
		const usage = await makeService('http://prometheus:9090').getUsage('7d');
		expect(usage.available).toBe(false);
		expect(usage.range).toBe('7d');
	});

	test('defaults to the one-hour range', async () => {
		const usage = await makeService('http://prometheus:9090').getUsage();
		expect(usage.range).toBe('1h');
		expect(queries[0]).toContain('[1m]');
	});
});
