import { describe, expect, test } from 'bun:test';
import { aggregateServiceUsage, emptyServiceUsage, parseCpuToMillicores, parseMemoryToBytes, type NodeStatsSummary } from '@kubwave/kube';

const SERVICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const NS = `kubwave-env-${SERVICE_ID}`; // namespace is the env's, not the service's, but any string works for the test

describe('parseCpuToMillicores', () => {
	test('millicpu, whole cores, and fractional cores', () => {
		expect(parseCpuToMillicores('500m')).toBe(500);
		expect(parseCpuToMillicores('2')).toBe(2000);
		expect(parseCpuToMillicores('0.5')).toBe(500);
	});
	test('absent or garbage → null', () => {
		expect(parseCpuToMillicores(undefined)).toBeNull();
		expect(parseCpuToMillicores('')).toBeNull();
		expect(parseCpuToMillicores('abc')).toBeNull();
	});
});

describe('parseMemoryToBytes', () => {
	test('binary and decimal suffixes and bare bytes', () => {
		expect(parseMemoryToBytes('512Mi')).toBe(512 * 1024 * 1024);
		expect(parseMemoryToBytes('1Gi')).toBe(1024 ** 3);
		expect(parseMemoryToBytes('100M')).toBe(100_000_000);
		expect(parseMemoryToBytes('1048576')).toBe(1_048_576);
	});
	test('absent or garbage → null', () => {
		expect(parseMemoryToBytes(undefined)).toBeNull();
		expect(parseMemoryToBytes('nope')).toBeNull();
	});
});

function summaryWith(pods: NodeStatsSummary['pods']): NodeStatsSummary {
	return { pods };
}

describe('aggregateServiceUsage', () => {
	test('sums CPU/memory/network across the service pods and maps PVC names', () => {
		const summaries: NodeStatsSummary[] = [
			summaryWith([
				{
					podRef: { name: 'svc-x-aaa', namespace: NS },
					cpu: { usageNanoCores: 250_000_000 }, // 250m
					memory: { workingSetBytes: 100 * 1024 * 1024 },
					network: { rxBytes: 1000, txBytes: 200 },
					volume: [{ pvcRef: { name: `svc-${SERVICE_ID}-data` }, usedBytes: 5_000, capacityBytes: 10_000 }]
				},
				{ podRef: { name: 'unrelated-pod', namespace: NS }, cpu: { usageNanoCores: 999_000_000 } }
			]),
			summaryWith([
				{
					podRef: { name: 'svc-x-bbb', namespace: NS },
					cpu: { usageNanoCores: 250_000_000 }, // 250m
					memory: { workingSetBytes: 50 * 1024 * 1024 },
					network: { rxBytes: 500, txBytes: 100 },
					volume: [{ pvcRef: { name: `svc-${SERVICE_ID}-data` }, usedBytes: 1_000, capacityBytes: 10_000 }]
				}
			])
		];

		const usage = aggregateServiceUsage({
			serviceId: SERVICE_ID,
			namespace: NS,
			pods: [
				{ name: 'svc-x-aaa', nodeName: 'node-1' },
				{ name: 'svc-x-bbb', nodeName: 'node-2' }
			],
			summaries,
			limits: { cpuLimit: '1', memoryLimit: '512Mi' }
		});

		expect(usage.available).toBe(true);
		expect(usage.replicas).toBe(2);
		expect(usage.cpuMillicores).toBe(500); // ignores the unrelated pod
		expect(usage.memoryBytes).toBe(150 * 1024 * 1024);
		expect(usage.networkRxBytes).toBe(1500);
		expect(usage.networkTxBytes).toBe(300);
		expect(usage.volumes).toEqual([{ name: 'data', usedBytes: 6_000, capacityBytes: 10_000 }]);
		expect(usage.cpuLimitMillicores).toBe(1000);
		expect(usage.memoryLimitBytes).toBe(512 * 1024 * 1024);
	});

	test('namespace mismatch is not counted', () => {
		const summaries = [summaryWith([{ podRef: { name: 'svc-x-aaa', namespace: 'other-ns' }, cpu: { usageNanoCores: 1_000_000_000 } }])];
		const usage = aggregateServiceUsage({
			serviceId: SERVICE_ID,
			namespace: NS,
			pods: [{ name: 'svc-x-aaa', nodeName: 'node-1' }],
			summaries
		});
		expect(usage.available).toBe(false);
		expect(usage.replicas).toBe(0);
		expect(usage.cpuMillicores).toBe(0);
	});

	test('no matching stats → unavailable but limits still resolved', () => {
		const usage = aggregateServiceUsage({
			serviceId: SERVICE_ID,
			namespace: NS,
			pods: [{ name: 'svc-x-aaa', nodeName: 'node-1' }],
			summaries: [summaryWith([])],
			limits: { cpuLimit: '500m', memoryLimit: '256Mi' }
		});
		expect(usage.available).toBe(false);
		expect(usage.cpuLimitMillicores).toBe(500);
		expect(usage.memoryLimitBytes).toBe(256 * 1024 * 1024);
	});
});

describe('emptyServiceUsage', () => {
	test('zeroed usage carries resolved limits', () => {
		const usage = emptyServiceUsage({ cpuLimit: '2', memoryLimit: '1Gi' });
		expect(usage.available).toBe(false);
		expect(usage.cpuMillicores).toBe(0);
		expect(usage.volumes).toEqual([]);
		expect(usage.cpuLimitMillicores).toBe(2000);
		expect(usage.memoryLimitBytes).toBe(1024 ** 3);
	});
});
