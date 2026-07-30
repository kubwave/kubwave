import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MetricsConfigService } from '~/shared/metrics/metrics-config.service';

mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

const { ClusterNodeUsageService } = await import('~/modules/platform/cluster/cluster-node-usage.service');

const originalFetch = globalThis.fetch;
let capturedQueries: string[] = [];
let prometheusUrl: string | null = 'http://prometheus:9090';

function makeService() {
	const metricsConfig = {
		getMetricsProviderSettings: async () => ({ provider: 'prometheus-managed', prometheusUrl }),
		resolvePrometheusUrl: () => prometheusUrl
	} as unknown as MetricsConfigService;
	return new ClusterNodeUsageService(metricsConfig);
}

// A distinct value per metric name so a query wired to the wrong metric surfaces as a wrong value, not a coincidentally-matching one.
function fixtureValueFor(query: string): string {
	if (query.includes('container_cpu_usage_seconds_total')) return '250';
	if (query.includes('container_memory_working_set_bytes')) return '500';
	return '750';
}

beforeEach(() => {
	capturedQueries = [];
	prometheusUrl = 'http://prometheus:9090';
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = input instanceof URL ? input : new URL(String(input));
		const query = url.searchParams.get('query') ?? '';
		capturedQueries.push(query);
		const value = fixtureValueFor(query);
		return new Response(JSON.stringify({ status: 'success', data: { result: [{ metric: {}, values: [[100, value]] }] } }), {
			headers: { 'content-type': 'application/json' }
		});
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('ClusterNodeUsageService', () => {
	test('scopes every query to the node and targets the right metric per series', async () => {
		await makeService().getUsage('node-1', '1h');
		expect(capturedQueries.length).toBe(3);
		expect(capturedQueries[0]).toContain('container_cpu_usage_seconds_total');
		expect(capturedQueries[1]).toContain('container_memory_working_set_bytes');
		expect(capturedQueries[2]).toContain('container_fs_usage_bytes');
		for (const query of capturedQueries) {
			expect(query).toContain('instance="node-1"');
		}
	});

	test('parses the returned matrix into points', async () => {
		const usage = await makeService().getUsage('node-1', '1h');
		expect(usage.available).toBe(true);
		expect(usage.range).toBe('1h');
		expect(usage.series.cpuMillicores).toEqual([{ t: 100, v: 250 }]);
		expect(usage.series.memoryBytes).toEqual([{ t: 100, v: 500 }]);
		expect(usage.series.diskBytes).toEqual([{ t: 100, v: 750 }]);
	});

	test('defaults to the 1h range', async () => {
		const usage = await makeService().getUsage('node-1');
		expect(usage.range).toBe('1h');
	});

	test('reports unavailable with empty series when no prometheus is configured', async () => {
		prometheusUrl = null;
		const usage = await makeService().getUsage('node-1', '24h');
		expect(usage).toEqual({
			available: false,
			range: '24h',
			sampledAt: expect.any(String),
			series: { cpuMillicores: [], memoryBytes: [], diskBytes: [] }
		});
		expect(capturedQueries).toEqual([]);
	});

	test('reports unavailable when prometheus errors', async () => {
		globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
		const usage = await makeService().getUsage('node-1', '1h');
		expect(usage.available).toBe(false);
	});
});
