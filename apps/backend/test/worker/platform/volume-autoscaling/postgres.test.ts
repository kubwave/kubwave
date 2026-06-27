import { describe, expect, test } from 'bun:test';
import type { CoreV1Event, CoreV1Api, CustomObjectsApi, StorageV1Api, V1PersistentVolumeClaim } from '@kubernetes/client-node';
import type { NodeStatsSummary } from '@kubwave/kube';
import { reconcilePostgresVolume } from '~/modules/worker/jobs/platform/volume-autoscaling/postgres';
import { AT_CAP_REPORTED_ANNOTATION, LAST_EXPANDED_ANNOTATION } from '~/modules/worker/jobs/platform/volume-autoscaling/decide';

// reconcilePostgresVolume with faked cluster I/O; grows the CNPG Cluster .spec.storage.size, never the instance PVCs.

const GI = 1024 ** 3;
const NAMESPACE = 'kubwave';
const CLUSTER_NAME = 'postgres';
const INSTANCE_POD = 'postgres-1';
const INSTANCE_PVC = 'postgres-1'; // CNPG data PVC is <cluster>-<n>

const notFound = () => ({ code: 404 });
const conflict = () => ({ code: 409 });

const defaultConfig = {
	enabled: true,
	thresholdPercent: 80,
	growthPercent: 50,
	caps: { postgres: '200Gi', registry: '200Gi', prometheus: '50Gi' }
};

interface FakeOptions {
	// CNPG Cluster CR, or null → getNamespacedCustomObject 404s (external DB).
	cluster: Record<string, unknown> | null;
	// Instance PVCs returned by listNamespacedPersistentVolumeClaim(CNPG_POD_SELECTOR).
	instancePvcs?: V1PersistentVolumeClaim[];
	allowExpansion?: boolean;
	storageClassMissing?: boolean;
	usedBytes?: number;
	capacityBytes?: number;
	// Throw 409 the first N times replaceNamespacedCustomObject is called.
	conflictTimes?: number;
}

function buildFake(opts: FakeOptions) {
	const calls: string[] = [];
	const replacedClusters: Record<string, unknown>[] = [];
	const events: CoreV1Event[] = [];
	const state = { cluster: opts.cluster };
	let conflictsLeft = opts.conflictTimes ?? 0;

	const coreApi = {
		listNamespacedPod: async ({ labelSelector }: { labelSelector?: string }) => {
			calls.push('listNamespacedPod');
			if (labelSelector === `cnpg.io/cluster=${CLUSTER_NAME}`) {
				return { items: [{ metadata: { name: INSTANCE_POD }, spec: { nodeName: 'node-a' } }] };
			}
			return { items: [] };
		},
		listNamespacedPersistentVolumeClaim: async () => {
			calls.push('listNamespacedPersistentVolumeClaim');
			return { items: opts.instancePvcs ?? [] };
		},
		connectGetNodeProxyWithPath: async (): Promise<NodeStatsSummary> => {
			calls.push('connectGetNodeProxyWithPath');
			return {
				pods: [
					{
						podRef: { name: INSTANCE_POD, namespace: NAMESPACE },
						volume: [
							{
								pvcRef: { name: INSTANCE_PVC, namespace: NAMESPACE },
								usedBytes: opts.usedBytes ?? 18 * GI,
								capacityBytes: opts.capacityBytes ?? 20 * GI
							}
						]
					}
				]
			};
		},
		createNamespacedEvent: async ({ body }: { body: CoreV1Event }) => {
			calls.push('createNamespacedEvent');
			events.push(body);
			return body;
		}
	} as unknown as CoreV1Api;

	const customApi = {
		getNamespacedCustomObject: async () => {
			calls.push('getNamespacedCustomObject');
			if (!state.cluster) throw notFound();
			return structuredClone(state.cluster);
		},
		replaceNamespacedCustomObject: async ({ body }: { body: Record<string, unknown> }) => {
			calls.push('replaceNamespacedCustomObject');
			if (conflictsLeft > 0) {
				conflictsLeft -= 1;
				throw conflict();
			}
			replacedClusters.push(body);
			state.cluster = structuredClone(body);
			return body;
		}
	} as unknown as CustomObjectsApi;

	const storageApi = {
		readStorageClass: async () => {
			calls.push('readStorageClass');
			if (opts.storageClassMissing) throw notFound();
			return { allowVolumeExpansion: opts.allowExpansion ?? true };
		}
	} as unknown as StorageV1Api;

	return { coreApi, customApi, storageApi, calls, replacedClusters, events, state };
}

function cluster(size: string, opts: { storageClass?: string; annotations?: Record<string, string>; uid?: string } = {}): Record<string, unknown> {
	return {
		metadata: { uid: opts.uid ?? 'pg-uid', annotations: { ...opts.annotations } },
		spec: { instances: 1, storage: { size, storageClass: opts.storageClass ?? 'standard' } }
	};
}

function pvc(requested: string): V1PersistentVolumeClaim {
	return {
		metadata: { name: INSTANCE_PVC },
		spec: { storageClassName: 'standard', resources: { requests: { storage: requested } } },
		status: { capacity: { storage: requested } }
	} as V1PersistentVolumeClaim;
}

async function run(fake: ReturnType<typeof buildFake>, config = defaultConfig) {
	const summaryCache = new Map<string, NodeStatsSummary | null>();
	await reconcilePostgresVolume(fake.coreApi, fake.customApi, fake.storageApi, NAMESPACE, config, summaryCache);
}

describe('reconcilePostgresVolume — absent / unscalable', () => {
	test('an absent CNPG Cluster (external DB) is a no-op', async () => {
		const fake = buildFake({ cluster: null });
		await run(fake);
		expect(fake.calls).toEqual(['getNamespacedCustomObject']);
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.events).toHaveLength(0);
	});

	test('an unparseable spec size or cap aborts before any cluster usage read', async () => {
		const fake = buildFake({ cluster: cluster('not-a-size') });
		await run(fake);
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.calls).not.toContain('listNamespacedPersistentVolumeClaim');
	});

	test('a bad cap value also aborts early', async () => {
		const fake = buildFake({ cluster: cluster('20Gi') });
		await run(fake, { ...defaultConfig, caps: { ...defaultConfig.caps, postgres: 'garbage' } });
		expect(fake.replacedClusters).toHaveLength(0);
	});
});

describe('reconcilePostgresVolume — expansion', () => {
	test('grows .spec.storage.size at 90% usage to 30Gi and emits a Normal VolumeExpanded event', async () => {
		const fake = buildFake({ cluster: cluster('20Gi'), instancePvcs: [pvc('20Gi')], usedBytes: 18 * GI, capacityBytes: 20 * GI });

		await run(fake);

		expect(fake.replacedClusters).toHaveLength(1);
		const grown = fake.replacedClusters[0]! as { spec: { storage: { size: string } }; metadata: { annotations: Record<string, string> } };
		expect(grown.spec.storage.size).toBe('30Gi');
		expect(Number.isFinite(Date.parse(grown.metadata.annotations[LAST_EXPANDED_ANNOTATION] ?? ''))).toBe(true);
		expect(grown.metadata.annotations[AT_CAP_REPORTED_ANNOTATION]).toBeUndefined();

		expect(fake.events).toHaveLength(1);
		expect(fake.events[0]!.type).toBe('Normal');
		expect(fake.events[0]!.reason).toBe('VolumeExpanded');
		expect(fake.events[0]!.involvedObject?.kind).toBe('Cluster');
		expect(fake.events[0]!.involvedObject?.name).toBe(CLUSTER_NAME);
	});

	test('does nothing below threshold (no replace, no event)', async () => {
		const fake = buildFake({ cluster: cluster('20Gi'), instancePvcs: [pvc('20Gi')], usedBytes: 10 * GI, capacityBytes: 20 * GI });
		await run(fake);
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.events).toHaveLength(0);
	});

	test('does nothing when the StorageClass disallows expansion', async () => {
		const fake = buildFake({
			cluster: cluster('20Gi'),
			instancePvcs: [pvc('20Gi')],
			allowExpansion: false,
			usedBytes: 18 * GI,
			capacityBytes: 20 * GI
		});
		await run(fake);
		expect(fake.calls).toContain('readStorageClass');
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.events).toHaveLength(0);
	});

	test('a missing StorageClass (404) reads as expansion-unsupported → no growth', async () => {
		const fake = buildFake({
			cluster: cluster('20Gi'),
			instancePvcs: [pvc('20Gi')],
			storageClassMissing: true,
			usedBytes: 18 * GI,
			capacityBytes: 20 * GI
		});
		await run(fake);
		expect(fake.replacedClusters).toHaveLength(0);
	});

	test('an in-flight resize (an instance PVC lagging the Cluster size) blocks a new expansion', async () => {
		// Cluster already at 30Gi but the instance PVC still requests 20Gi → resize in flight.
		const fake = buildFake({ cluster: cluster('30Gi'), instancePvcs: [pvc('20Gi')], usedBytes: 28 * GI, capacityBytes: 30 * GI });
		await run(fake);
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.events).toHaveLength(0);
	});

	test('honors the cooldown since the last expansion', async () => {
		const recent = cluster('20Gi', { annotations: { [LAST_EXPANDED_ANNOTATION]: new Date().toISOString() } });
		const fake = buildFake({ cluster: recent, instancePvcs: [pvc('20Gi')], usedBytes: 18 * GI, capacityBytes: 20 * GI });
		await run(fake);
		expect(fake.replacedClusters).toHaveLength(0);
	});
});

describe('reconcilePostgresVolume — at cap', () => {
	test('warns once per size, then stays silent on the next sweep', async () => {
		// Cap == current size (20Gi) and over threshold → at-cap.
		const fake = buildFake({ cluster: cluster('20Gi'), instancePvcs: [pvc('20Gi')], usedBytes: 18 * GI, capacityBytes: 20 * GI });
		const config = { ...defaultConfig, caps: { ...defaultConfig.caps, postgres: '20Gi' } };

		await run(fake, config);

		expect(fake.replacedClusters).toHaveLength(1);
		const marked = fake.replacedClusters[0]! as { spec: { storage: { size: string } }; metadata: { annotations: Record<string, string> } };
		expect(marked.spec.storage.size).toBe('20Gi'); // never grown past the cap
		expect(marked.metadata.annotations[AT_CAP_REPORTED_ANNOTATION]).toBe('20Gi');
		expect(marked.metadata.annotations[LAST_EXPANDED_ANNOTATION]).toBeUndefined();
		expect(fake.events).toHaveLength(1);
		expect(fake.events[0]!.type).toBe('Warning');
		expect(fake.events[0]!.reason).toBe('VolumeAtCap');

		// Second sweep: annotation already matches the size → no replace, no event.
		await run(fake, config);
		expect(fake.replacedClusters).toHaveLength(1);
		expect(fake.events).toHaveLength(1);
	});
});

describe('reconcilePostgresVolume — conflict handling', () => {
	test('a 409 on replace is retried and the expansion still lands', async () => {
		const fake = buildFake({ cluster: cluster('20Gi'), instancePvcs: [pvc('20Gi')], usedBytes: 18 * GI, capacityBytes: 20 * GI, conflictTimes: 1 });
		await run(fake);
		expect(fake.replacedClusters).toHaveLength(1);
		expect(fake.replacedClusters[0]).toBeDefined();
	});

	test('a shrink-race guard: if the re-read shows the Cluster already grew, the smaller write is skipped', async () => {
		// Decision sees 20Gi (grow to 30Gi), but a concurrent grow landed 40Gi before the re-read → skip the write.
		const fake = buildFake({ cluster: cluster('20Gi'), instancePvcs: [pvc('20Gi')], usedBytes: 18 * GI, capacityBytes: 20 * GI });
		let gets = 0;
		const racingApi = {
			getNamespacedCustomObject: async () => {
				gets += 1;
				fake.calls.push('getNamespacedCustomObject');
				return structuredClone(gets === 1 ? cluster('20Gi') : cluster('40Gi'));
			},
			replaceNamespacedCustomObject: fake.customApi.replaceNamespacedCustomObject
		} as unknown as CustomObjectsApi;

		await reconcilePostgresVolume(fake.coreApi, racingApi, fake.storageApi, NAMESPACE, defaultConfig, new Map());

		expect(fake.replacedClusters).toHaveLength(0);
	});
});
