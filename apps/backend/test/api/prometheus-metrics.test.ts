import { afterEach, describe, expect, test } from 'bun:test';
import { PrometheusMetricsService } from '~/modules/services/metrics/prometheus.service';
import type { ServiceView } from '~/modules/services/services.types';

const SERVICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const ENV_ID = '660e8400-e29b-41d4-a716-446655440111';

const service: ServiceView = {
	id: SERVICE_ID,
	environmentId: ENV_ID,
	name: 'demo',
	description: '',
	type: 'docker-image',
	config: {
		image: 'nginx',
		tag: 'latest',
		containerPort: 80,
		env: [] as { key: string; value: string }[],
		secrets: [] as { key: string; hasValue: boolean }[],
		domains: [] as { host: string; port: number }[],
		volumes: [{ name: 'data', mountPath: '/data', size: '10Gi' }],
		resources: { cpuLimit: '1', memoryLimit: '512Mi' }
	},
	autoDeploy: { enabled: false, lastPolledCommit: null, lastPolledAt: null, nextPollAt: null, lastPollError: null },
	internalDomain: null,
	defaultUrl: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
};

const metricsService = new PrometheusMetricsService();
const originalFetch = globalThis.fetch;
const capturedQueries: string[] = [];

function matrix(values: [number, string][], labels: Record<string, string> = {}) {
	return { metric: labels, values };
}

function mockFetch(byQuery: (q: string) => unknown[]) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = input instanceof URL ? input : new URL(String(input));
		const query = url.searchParams.get('query') ?? '';
		capturedQueries.push(query);
		return new Response(JSON.stringify({ status: 'success', data: { result: byQuery(query) } }), { headers: { 'content-type': 'application/json' } });
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	capturedQueries.length = 0;
});

describe('getPrometheusServiceMetrics', () => {
	test('builds namespaced/pod-scoped queries and parses series + current values', async () => {
		mockFetch(q => {
			if (q.includes('container_cpu_usage_seconds_total'))
				return [
					matrix([
						[100, '250'],
						[160, '500']
					])
				];
			if (q.includes('container_memory_working_set_bytes'))
				return [
					matrix([
						[100, '1000'],
						[160, '2000']
					])
				];
			if (q.includes('container_network_receive_bytes_total'))
				return [
					matrix([
						[100, '10'],
						[160, '20']
					])
				];
			if (q.includes('container_network_transmit_bytes_total'))
				return [
					matrix([
						[100, '5'],
						[160, '8']
					])
				];
			if (q.includes('kubelet_volume_stats_used_bytes'))
				return [
					matrix(
						[
							[100, '500'],
							[160, '600']
						],
						{ persistentvolumeclaim: `svc-${SERVICE_ID}-data` }
					)
				];
			if (q.includes('kubelet_volume_stats_capacity_bytes')) return [matrix([[160, '10000']], { persistentvolumeclaim: `svc-${SERVICE_ID}-data` })];
			return [];
		});

		const metrics = await metricsService.getServiceMetrics({ baseUrl: 'http://prom:9090', service, serviceId: SERVICE_ID, range: '1h' });

		expect(metrics.mode).toBe('historical');
		expect(metrics.available).toBe(true);
		expect(metrics.current.cpuMillicores).toBe(500);
		expect(metrics.current.memoryBytes).toBe(2000);
		expect(metrics.current.networkRxBytes).toBe(20);
		expect(metrics.current.networkTxBytes).toBe(8);
		expect(metrics.current.volumes).toEqual([{ name: 'data', usedBytes: 600, capacityBytes: 10000 }]);
		expect(metrics.series?.cpuMillicores).toHaveLength(2);
		expect(metrics.series?.volumes[0]?.name).toBe('data');
		expect(metrics.limits.cpuMillicores).toBe(1000);
		expect(metrics.limits.memoryBytes).toBe(512 * 1024 * 1024);

		// Every query is scoped to the env namespace and the service's pods/PVCs.
		const cpuQuery = capturedQueries.find(q => q.includes('container_cpu_usage_seconds_total'))!;
		expect(cpuQuery).toContain(`namespace="kubwave-env-${ENV_ID}"`);
		expect(cpuQuery).toContain(`pod=~"svc-${SERVICE_ID}-.*"`);
		const pvcQuery = capturedQueries.find(q => q.includes('kubelet_volume_stats_used_bytes'))!;
		expect(pvcQuery).toContain(`persistentvolumeclaim=~"svc-${SERVICE_ID}-.*"`);
	});

	test('no data → available false', async () => {
		mockFetch(() => []);
		const metrics = await metricsService.getServiceMetrics({ baseUrl: 'http://prom:9090', service, serviceId: SERVICE_ID, range: '24h' });
		expect(metrics.available).toBe(false);
		expect(metrics.current.cpuMillicores).toBe(0);
	});

	test('a failed query rejects (so the caller can fall back to live)', async () => {
		globalThis.fetch = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
		await expect(metricsService.getServiceMetrics({ baseUrl: 'http://prom:9090', service, serviceId: SERVICE_ID, range: '1h' })).rejects.toThrow();
	});
});
