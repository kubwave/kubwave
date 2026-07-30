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

beforeEach(() => {
	capturedQueries = [];
	prometheusUrl = 'http://prometheus:9090';
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = input instanceof URL ? input : new URL(String(input));
		capturedQueries.push(url.searchParams.get('query') ?? '');
		return new Response(JSON.stringify({ status: 'success', data: { result: [{ metric: {}, values: [[100, '250']] }] } }), {
			headers: { 'content-type': 'application/json' }
		});
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('ClusterNodeUsageService', () => {
	test('scopes every query to the node', async () => {
		await makeService().getUsage('node-1', '1h');
		expect(capturedQueries.length).toBe(3);
		for (const query of capturedQueries) {
			expect(query).toContain('instance="node-1"');
		}
	});

	test('parses the returned matrix into points', async () => {
		const usage = await makeService().getUsage('node-1', '1h');
		expect(usage.available).toBe(true);
		expect(usage.range).toBe('1h');
		expect(usage.series.cpuMillicores).toEqual([{ t: 100, v: 250 }]);
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
