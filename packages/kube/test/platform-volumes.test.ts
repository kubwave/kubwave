import { describe, expect, test } from 'bun:test';
import type { CoreV1Api } from '@kubernetes/client-node';
import type { NodeStatsSummary } from '../src/metrics/index';
import {
	CNPG_CLUSTER_NAME,
	CNPG_DATA_PVC,
	CNPG_POD_SELECTOR,
	fullestPvcUsage,
	maxPvcUsage,
	PROMETHEUS_NAME,
	PROMETHEUS_POD_SELECTOR,
	PROMETHEUS_PVC_NAME,
	readPlatformVolumeUsage,
	REGISTRY_POD_SELECTOR,
	REGISTRY_PVC_NAME,
	type PodRef
} from '../src/platform/volumes';

describe('exported constants', () => {
	test('coordinates mirror the chart', () => {
		expect(REGISTRY_PVC_NAME).toBe('kubwave-registry-data');
		expect(REGISTRY_POD_SELECTOR).toBe('app.kubernetes.io/name=registry');
		expect(PROMETHEUS_NAME).toBe('kubwave-prometheus');
		expect(PROMETHEUS_PVC_NAME).toBe('kubwave-prometheus-data');
		expect(PROMETHEUS_POD_SELECTOR).toBe('app.kubernetes.io/name=kubwave-prometheus');
		expect(CNPG_CLUSTER_NAME).toBe('postgres');
		expect(CNPG_POD_SELECTOR).toBe('cnpg.io/cluster=postgres');
	});
});

describe('CNPG_DATA_PVC', () => {
	test('matches data PVCs <cluster>-<n>', () => {
		expect(CNPG_DATA_PVC.test('postgres-1')).toBe(true);
		expect(CNPG_DATA_PVC.test('postgres-2')).toBe(true);
	});

	test('rejects the bare cluster, non-numeric, and wal PVCs', () => {
		expect(CNPG_DATA_PVC.test('postgres')).toBe(false);
		expect(CNPG_DATA_PVC.test('postgres-x')).toBe(false);
		expect(CNPG_DATA_PVC.test('postgres-1-wal')).toBe(false);
	});
});

describe('fullestPvcUsage', () => {
	const wantsAll = () => true;

	test('empty pods → null', () => {
		expect(fullestPvcUsage('ns', [], [], wantsAll)).toBeNull();
	});

	test('picks the highest-usage-ratio PVC across pods', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						volume: [{ pvcRef: { name: 'postgres-1' }, usedBytes: 10, capacityBytes: 100 }] // 10%
					},
					{
						podRef: { namespace: 'ns', name: 'p2' },
						volume: [{ pvcRef: { name: 'postgres-2' }, time: '2026-06-20T19:25:29Z', usedBytes: 90, capacityBytes: 100 }] // 90%
					}
				]
			}
		];
		const pods: PodRef[] = [
			{ name: 'p1', nodeName: 'n1' },
			{ name: 'p2', nodeName: 'n1' }
		];
		expect(fullestPvcUsage('ns', pods, summaries, wantsAll)).toEqual({ usedBytes: 90, capacityBytes: 100, sampledAt: '2026-06-20T19:25:29Z' });
	});

	test('honours the wantsPvc filter', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						volume: [
							{ pvcRef: { name: 'postgres-1' }, usedBytes: 10, capacityBytes: 100 },
							{ pvcRef: { name: 'other' }, usedBytes: 99, capacityBytes: 100 }
						]
					}
				]
			}
		];
		const pods: PodRef[] = [{ name: 'p1', nodeName: 'n1' }];
		// Only postgres-1 is wanted even though `other` is fuller.
		expect(fullestPvcUsage('ns', pods, summaries, n => CNPG_DATA_PVC.test(n))).toEqual({ usedBytes: 10, capacityBytes: 100 });
	});

	test('ignores volumes lacking usedBytes or capacityBytes', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						volume: [
							{ pvcRef: { name: 'postgres-1' }, capacityBytes: 100 }, // no usedBytes
							{ pvcRef: { name: 'postgres-2' }, usedBytes: 50 }, // no capacityBytes
							{ pvcRef: { name: 'postgres-3' }, usedBytes: 5, capacityBytes: 0 } // zero capacity (falsy)
						]
					}
				]
			}
		];
		const pods: PodRef[] = [{ name: 'p1', nodeName: 'n1' }];
		expect(fullestPvcUsage('ns', pods, summaries, wantsAll)).toBeNull();
	});

	test('keeps the first on a tie (strict >)', () => {
		const summaries: NodeStatsSummary[] = [
			{
				pods: [
					{
						podRef: { namespace: 'ns', name: 'p1' },
						volume: [
							{ pvcRef: { name: 'postgres-1' }, usedBytes: 50, capacityBytes: 100 },
							{ pvcRef: { name: 'postgres-2' }, usedBytes: 50, capacityBytes: 100 }
						]
					}
				]
			}
		];
		const pods: PodRef[] = [{ name: 'p1', nodeName: 'n1' }];
		// Equal ratio: strict `>` means the first encountered wins, but values are identical.
		expect(fullestPvcUsage('ns', pods, summaries, wantsAll)).toEqual({ usedBytes: 50, capacityBytes: 100 });
	});

	test('pod with no matching stats is skipped', () => {
		const summaries: NodeStatsSummary[] = [{ pods: [] }];
		const pods: PodRef[] = [{ name: 'ghost', nodeName: 'n1' }];
		expect(fullestPvcUsage('ns', pods, summaries, wantsAll)).toBeNull();
	});
});

// Build a fake CoreV1Api: a pod list per selector + a per-node summary payload.
function fakeApi(opts: {
	podsBySelector: Record<string, { name: string; nodeName: string }[]>;
	summaries: Record<string, NodeStatsSummary>;
	failNode?: string;
}): CoreV1Api {
	return {
		listNamespacedPod: async ({ labelSelector }: { labelSelector: string }) => ({
			items: (opts.podsBySelector[labelSelector] ?? []).map(p => ({
				metadata: { name: p.name },
				spec: { nodeName: p.nodeName }
			}))
		}),
		connectGetNodeProxyWithPath: async ({ name }: { name: string }) => {
			if (name === opts.failNode) throw { code: 404 };
			return JSON.stringify(opts.summaries[name] ?? { pods: [] });
		}
	} as unknown as CoreV1Api;
}

describe('maxPvcUsage', () => {
	test('returns the fullest matching PVC for the selector', async () => {
		const api = fakeApi({
			podsBySelector: { 'app=reg': [{ name: 'reg-0', nodeName: 'n1' }] },
			summaries: {
				n1: {
					pods: [
						{
							podRef: { namespace: 'ns', name: 'reg-0' },
							volume: [{ pvcRef: { name: REGISTRY_PVC_NAME }, usedBytes: 75, capacityBytes: 100 }]
						}
					]
				}
			}
		});
		const usage = await maxPvcUsage(api, 'ns', 'app=reg', n => n === REGISTRY_PVC_NAME, new Map());
		expect(usage).toEqual({ usedBytes: 75, capacityBytes: 100 });
	});

	test('null when the selector matches no pods', async () => {
		const api = fakeApi({ podsBySelector: {}, summaries: {} });
		expect(await maxPvcUsage(api, 'ns', 'app=none', () => true, new Map())).toBeNull();
	});

	test('a failed node summary skips that node (returns null, does not throw)', async () => {
		const api = fakeApi({
			podsBySelector: { 'app=reg': [{ name: 'reg-0', nodeName: 'bad' }] },
			summaries: {},
			failNode: 'bad'
		});
		expect(await maxPvcUsage(api, 'ns', 'app=reg', () => true, new Map())).toBeNull();
	});

	test('reuses the summary cache (no second proxy fetch per node)', async () => {
		let proxyCalls = 0;
		const summary: NodeStatsSummary = {
			pods: [
				{
					podRef: { namespace: 'ns', name: 'reg-0' },
					volume: [{ pvcRef: { name: REGISTRY_PVC_NAME }, usedBytes: 1, capacityBytes: 10 }]
				}
			]
		};
		const api = {
			listNamespacedPod: async () => ({ items: [{ metadata: { name: 'reg-0' }, spec: { nodeName: 'n1' } }] }),
			connectGetNodeProxyWithPath: async () => {
				proxyCalls++;
				return JSON.stringify(summary);
			}
		} as unknown as CoreV1Api;
		const cache = new Map();
		await maxPvcUsage(api, 'ns', 'app=reg', () => true, cache);
		await maxPvcUsage(api, 'ns', 'app=reg', () => true, cache);
		expect(proxyCalls).toBe(1); // second call served from the cache
	});
});

describe('readPlatformVolumeUsage', () => {
	test('returns registry, postgres, and prometheus usage when present', async () => {
		const api = fakeApi({
			podsBySelector: {
				[REGISTRY_POD_SELECTOR]: [{ name: 'reg-0', nodeName: 'n1' }],
				[CNPG_POD_SELECTOR]: [{ name: 'pg-0', nodeName: 'n2' }],
				[PROMETHEUS_POD_SELECTOR]: [{ name: 'prom-0', nodeName: 'n1' }]
			},
			summaries: {
				n1: {
					pods: [
						{
							podRef: { namespace: 'ns', name: 'reg-0' },
							volume: [{ pvcRef: { name: REGISTRY_PVC_NAME }, usedBytes: 30, capacityBytes: 100 }]
						},
						{
							podRef: { namespace: 'ns', name: 'prom-0' },
							volume: [{ pvcRef: { name: PROMETHEUS_PVC_NAME }, usedBytes: 20, capacityBytes: 100 }]
						}
					]
				},
				n2: {
					pods: [
						{
							podRef: { namespace: 'ns', name: 'pg-0' },
							volume: [{ pvcRef: { name: 'postgres-1' }, usedBytes: 60, capacityBytes: 100 }]
						}
					]
				}
			}
		});
		const usage = await readPlatformVolumeUsage(api, 'ns');
		expect(usage.registry).toEqual({ usedBytes: 30, capacityBytes: 100 });
		expect(usage.postgres).toEqual({ usedBytes: 60, capacityBytes: 100 });
		expect(usage.prometheus).toEqual({ usedBytes: 20, capacityBytes: 100 });
	});

	test('null for a volume that is not present', async () => {
		const api = fakeApi({
			podsBySelector: {
				[REGISTRY_POD_SELECTOR]: [{ name: 'reg-0', nodeName: 'n1' }]
				// no postgres pods
			},
			summaries: {
				n1: {
					pods: [
						{
							podRef: { namespace: 'ns', name: 'reg-0' },
							volume: [{ pvcRef: { name: REGISTRY_PVC_NAME }, usedBytes: 30, capacityBytes: 100 }]
						}
					]
				}
			}
		});
		const usage = await readPlatformVolumeUsage(api, 'ns');
		expect(usage.registry).toEqual({ usedBytes: 30, capacityBytes: 100 });
		expect(usage.postgres).toBeNull();
		expect(usage.prometheus).toBeNull();
	});

	test('the postgres selector only counts data PVCs (wal excluded)', async () => {
		const api = fakeApi({
			podsBySelector: {
				[REGISTRY_POD_SELECTOR]: [],
				[CNPG_POD_SELECTOR]: [{ name: 'pg-0', nodeName: 'n1' }]
			},
			summaries: {
				n1: {
					pods: [
						{
							podRef: { namespace: 'ns', name: 'pg-0' },
							volume: [
								{ pvcRef: { name: 'postgres-1-wal' }, usedBytes: 99, capacityBytes: 100 }, // excluded
								{ pvcRef: { name: 'postgres-1' }, usedBytes: 40, capacityBytes: 100 }
							]
						}
					]
				}
			}
		});
		const usage = await readPlatformVolumeUsage(api, 'ns');
		expect(usage.registry).toBeNull();
		expect(usage.postgres).toEqual({ usedBytes: 40, capacityBytes: 100 });
		expect(usage.prometheus).toBeNull();
	});
});
