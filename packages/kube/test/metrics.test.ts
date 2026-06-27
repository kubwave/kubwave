import { describe, expect, test } from 'bun:test';
import type { CoreV1Api } from '@kubernetes/client-node';
import {
	aggregateServiceUsage,
	emptyServiceUsage,
	nodeStatsSummary,
	parseCpuToMillicores,
	parseMemoryToBytes,
	serviceVolumeNameFromPvc,
	type NodeStatsSummary
} from '../src/metrics/index';

describe('parseCpuToMillicores', () => {
	test('plain cores → millicores', () => {
		expect(parseCpuToMillicores('1')).toBe(1000);
		expect(parseCpuToMillicores('0.5')).toBe(500);
		expect(parseCpuToMillicores('2')).toBe(2000);
	});

	test('millicore suffix is taken verbatim', () => {
		expect(parseCpuToMillicores('500m')).toBe(500);
		expect(parseCpuToMillicores('1500m')).toBe(1500);
	});

	test('trims surrounding whitespace', () => {
		expect(parseCpuToMillicores('  250m  ')).toBe(250);
		expect(parseCpuToMillicores(' 1 ')).toBe(1000);
	});

	test('null / undefined / empty → null', () => {
		expect(parseCpuToMillicores(null)).toBeNull();
		expect(parseCpuToMillicores(undefined)).toBeNull();
		expect(parseCpuToMillicores('')).toBeNull();
	});

	test('garbage → null (both suffixed and plain)', () => {
		expect(parseCpuToMillicores('abcm')).toBeNull();
		expect(parseCpuToMillicores('xyz')).toBeNull();
	});
});

describe('parseMemoryToBytes', () => {
	test('binary suffixes Ki/Mi/Gi/Ti', () => {
		expect(parseMemoryToBytes('1Ki')).toBe(1024);
		expect(parseMemoryToBytes('1Mi')).toBe(1024 ** 2);
		expect(parseMemoryToBytes('2Gi')).toBe(2 * 1024 ** 3);
		expect(parseMemoryToBytes('1Ti')).toBe(1024 ** 4);
	});

	test('decimal suffixes k/M/G', () => {
		expect(parseMemoryToBytes('1k')).toBe(1000);
		expect(parseMemoryToBytes('5M')).toBe(5_000_000);
		expect(parseMemoryToBytes('1G')).toBe(1_000_000_000);
	});

	test('plain bytes (rounded)', () => {
		expect(parseMemoryToBytes('1024')).toBe(1024);
		expect(parseMemoryToBytes('100.6')).toBe(101);
	});

	test('null / undefined / garbage → null', () => {
		expect(parseMemoryToBytes(null)).toBeNull();
		expect(parseMemoryToBytes(undefined)).toBeNull();
		expect(parseMemoryToBytes('')).toBeNull();
		expect(parseMemoryToBytes('notabyte')).toBeNull();
		expect(parseMemoryToBytes('xxGi')).toBeNull();
	});
});

describe('serviceVolumeNameFromPvc', () => {
	test('strips the svc-<id>- prefix → logical volume name', () => {
		expect(serviceVolumeNameFromPvc('s1', 'svc-s1-data')).toBe('data');
		expect(serviceVolumeNameFromPvc('s1', 'svc-s1-cache')).toBe('cache');
	});

	test('null when the claim does not belong to the service', () => {
		expect(serviceVolumeNameFromPvc('s1', 'svc-other-data')).toBeNull();
		expect(serviceVolumeNameFromPvc('s1', 'random-pvc')).toBeNull();
	});

	test('null/undefined claim → null', () => {
		expect(serviceVolumeNameFromPvc('s1', undefined)).toBeNull();
	});
});

describe('emptyServiceUsage', () => {
	test('zeroed usage with no limits', () => {
		expect(emptyServiceUsage()).toEqual({
			available: false,
			replicas: 0,
			cpuMillicores: 0,
			memoryBytes: 0,
			networkRxBytes: 0,
			networkTxBytes: 0,
			volumes: [],
			cpuLimitMillicores: null,
			memoryLimitBytes: null
		});
	});

	test('threads limits through', () => {
		const u = emptyServiceUsage({ cpuLimit: '500m', memoryLimit: '2Gi' });
		expect(u.cpuLimitMillicores).toBe(500);
		expect(u.memoryLimitBytes).toBe(2 * 1024 ** 3);
		expect(u.available).toBe(false);
	});
});

describe('aggregateServiceUsage', () => {
	test('empty pods → unavailable zeroed usage', () => {
		const u = aggregateServiceUsage({ serviceId: 's1', namespace: 'ns', pods: [], summaries: [] });
		expect(u.available).toBe(false);
		expect(u.replicas).toBe(0);
		expect(u.cpuMillicores).toBe(0);
		expect(u.volumes).toEqual([]);
	});

	test('sums CPU/memory/network across multiple matched pods', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						cpu: { usageNanoCores: 250_000_000 }, // → 250m
						memory: { workingSetBytes: 1000 },
						network: { rxBytes: 10, txBytes: 5 }
					},
					{
						podRef: { namespace: 'ns', name: 'p2' },
						cpu: { usageNanoCores: 500_000_000 }, // → 500m
						memory: { workingSetBytes: 2000 },
						network: { rxBytes: 20, txBytes: 7 }
					}
				]
			}
		];
		const u = aggregateServiceUsage({
			serviceId: 's1',
			namespace: 'ns',
			pods: [
				{ name: 'p1', nodeName: 'n1' },
				{ name: 'p2', nodeName: 'n1' }
			],
			summaries
		});
		expect(u.available).toBe(true);
		expect(u.replicas).toBe(2);
		expect(u.cpuMillicores).toBe(750);
		expect(u.memoryBytes).toBe(3000);
		expect(u.networkRxBytes).toBe(30);
		expect(u.networkTxBytes).toBe(12);
	});

	test('ignores pods in other namespaces and pods with no stats', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{ podRef: { namespace: 'other', name: 'p1' }, cpu: { usageNanoCores: 1_000_000_000 } },
					{ podRef: { namespace: 'ns', name: 'p1' }, cpu: { usageNanoCores: 100_000_000 } }
				]
			}
		];
		const u = aggregateServiceUsage({
			serviceId: 's1',
			namespace: 'ns',
			pods: [
				{ name: 'p1', nodeName: 'n1' },
				{ name: 'p-missing', nodeName: 'n1' }
			],
			summaries
		});
		expect(u.replicas).toBe(1); // only ns/p1 matched
		expect(u.cpuMillicores).toBe(100);
	});

	test('attaches PVC usage, aggregating across pods (sum used, max capacity)', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						volume: [
							{ pvcRef: { name: 'svc-s1-data' }, usedBytes: 100, capacityBytes: 1000 },
							{ pvcRef: { name: 'unrelated-pvc' }, usedBytes: 9999, capacityBytes: 9999 }
						]
					},
					{
						podRef: { namespace: 'ns', name: 'p2' },
						volume: [{ pvcRef: { name: 'svc-s1-data' }, usedBytes: 50, capacityBytes: 2000 }]
					}
				]
			}
		];
		const u = aggregateServiceUsage({
			serviceId: 's1',
			namespace: 'ns',
			pods: [
				{ name: 'p1', nodeName: 'n1' },
				{ name: 'p2', nodeName: 'n1' }
			],
			summaries
		});
		expect(u.volumes).toEqual([{ name: 'data', usedBytes: 150, capacityBytes: 2000 }]);
	});

	test('volumes are sorted by name', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						volume: [
							{ pvcRef: { name: 'svc-s1-zeta' }, usedBytes: 1, capacityBytes: 10 },
							{ pvcRef: { name: 'svc-s1-alpha' }, usedBytes: 1, capacityBytes: 10 }
						]
					}
				]
			}
		];
		const u = aggregateServiceUsage({
			serviceId: 's1',
			namespace: 'ns',
			pods: [{ name: 'p1', nodeName: 'n1' }],
			summaries
		});
		expect(u.volumes.map(v => v.name)).toEqual(['alpha', 'zeta']);
	});

	test('threads CPU/memory limits through', () => {
		const u = aggregateServiceUsage({
			serviceId: 's1',
			namespace: 'ns',
			pods: [],
			summaries: [],
			limits: { cpuLimit: '1', memoryLimit: '512Mi' }
		});
		expect(u.cpuLimitMillicores).toBe(1000);
		expect(u.memoryLimitBytes).toBe(512 * 1024 ** 2);
	});

	test('missing cpu/memory/network fields default to 0', () => {
		const summaries: NodeStatsSummary[] = [{ pods: [{ podRef: { namespace: 'ns', name: 'p1' } }] }];
		const u = aggregateServiceUsage({
			serviceId: 's1',
			namespace: 'ns',
			pods: [{ name: 'p1', nodeName: 'n1' }],
			summaries
		});
		expect(u.available).toBe(true);
		expect(u.cpuMillicores).toBe(0);
		expect(u.memoryBytes).toBe(0);
		expect(u.networkRxBytes).toBe(0);
		expect(u.networkTxBytes).toBe(0);
	});
});

describe('nodeStatsSummary', () => {
	test('parses a JSON string body from the node proxy', async () => {
		const payload: NodeStatsSummary = { pods: [{ podRef: { namespace: 'ns', name: 'p1' } }] };
		const api = {
			connectGetNodeProxyWithPath: async () => JSON.stringify(payload)
		} as unknown as CoreV1Api;
		expect(await nodeStatsSummary(api, 'node-1')).toEqual(payload);
	});

	test('passes an already-parsed object body through', async () => {
		const payload: NodeStatsSummary = { pods: [] };
		const api = {
			connectGetNodeProxyWithPath: async () => payload
		} as unknown as CoreV1Api;
		expect(await nodeStatsSummary(api, 'node-1')).toBe(payload);
	});
});
