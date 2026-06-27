import { describe, expect, test } from 'bun:test';
import { CNPG_DATA_PVC, fullestPvcUsage, REGISTRY_PVC_NAME, type NodeStatsSummary, type PodRef } from '@kubwave/kube';

const NS = 'kubwave';

function summaryWith(pods: NodeStatsSummary['pods']): NodeStatsSummary {
	return { pods };
}

describe('CNPG_DATA_PVC', () => {
	test('matches data PVCs but not wal PVCs', () => {
		expect(CNPG_DATA_PVC.test('postgres-1')).toBe(true);
		expect(CNPG_DATA_PVC.test('postgres-3')).toBe(true);
		expect(CNPG_DATA_PVC.test('postgres-1-wal')).toBe(false);
		expect(CNPG_DATA_PVC.test('postgres')).toBe(false);
	});
});

describe('fullestPvcUsage', () => {
	test('registry: reads the single matching PVC', () => {
		const pods: PodRef[] = [{ name: 'kubwave-registry-abc', nodeName: 'node-a' }];
		const summaries = [
			summaryWith([
				{
					podRef: { name: 'kubwave-registry-abc', namespace: NS },
					volume: [{ pvcRef: { name: REGISTRY_PVC_NAME }, usedBytes: 6_000, capacityBytes: 10_000 }]
				}
			])
		];
		expect(fullestPvcUsage(NS, pods, summaries, n => n === REGISTRY_PVC_NAME)).toEqual({ usedBytes: 6_000, capacityBytes: 10_000 });
	});

	test('postgres HA: picks the fullest instance by ratio', () => {
		const pods: PodRef[] = [
			{ name: 'postgres-1', nodeName: 'node-a' },
			{ name: 'postgres-2', nodeName: 'node-b' }
		];
		const summaries = [
			summaryWith([
				{ podRef: { name: 'postgres-1', namespace: NS }, volume: [{ pvcRef: { name: 'postgres-1' }, usedBytes: 5_000, capacityBytes: 10_000 }] }
			]),
			summaryWith([
				{ podRef: { name: 'postgres-2', namespace: NS }, volume: [{ pvcRef: { name: 'postgres-2' }, usedBytes: 9_000, capacityBytes: 10_000 }] }
			])
		];
		// 90% beats 50% — the fullest drives the shared-Cluster decision/display.
		expect(fullestPvcUsage(NS, pods, summaries, n => CNPG_DATA_PVC.test(n))).toEqual({ usedBytes: 9_000, capacityBytes: 10_000 });
	});

	test('ignores non-matching PVCs, zero capacity, and missing usage', () => {
		const pods: PodRef[] = [{ name: 'postgres-1', nodeName: 'node-a' }];
		const summaries = [
			summaryWith([
				{
					podRef: { name: 'postgres-1', namespace: NS },
					volume: [
						{ pvcRef: { name: 'postgres-1-wal' }, usedBytes: 9_999, capacityBytes: 10_000 }, // wrong PVC
						{ pvcRef: { name: 'postgres-1' }, usedBytes: undefined, capacityBytes: 10_000 }, // no usage
						{ pvcRef: { name: 'postgres-1' }, usedBytes: 1, capacityBytes: 0 } // zero capacity
					]
				}
			])
		];
		expect(fullestPvcUsage(NS, pods, summaries, n => CNPG_DATA_PVC.test(n))).toBeNull();
	});

	test('does not match a same-named pod in another namespace', () => {
		const pods: PodRef[] = [{ name: 'postgres-1', nodeName: 'node-a' }];
		const summaries = [
			summaryWith([
				{
					podRef: { name: 'postgres-1', namespace: 'other-ns' },
					volume: [{ pvcRef: { name: 'postgres-1' }, usedBytes: 9_000, capacityBytes: 10_000 }]
				}
			])
		];
		expect(fullestPvcUsage(NS, pods, summaries, n => CNPG_DATA_PVC.test(n))).toBeNull();
	});
});
