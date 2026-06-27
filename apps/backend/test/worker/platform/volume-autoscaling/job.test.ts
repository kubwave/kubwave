import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { CoreV1Event, KubeConfig, V1PersistentVolumeClaim } from '@kubernetes/client-node';
import { AT_CAP_REPORTED_ANNOTATION, LAST_EXPANDED_ANNOTATION } from '~/modules/worker/jobs/platform/volume-autoscaling/decide';

// runVolumeAutoscaling with mocked DB + fake k8s clients; decision logic and kube helpers run for real.

// The sweep reads the admin setting via a dynamic db import; each test points settingsRow at the row.
let settingsRow: { value: unknown } | null = null;

mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));
mock.module('@kubwave/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (settingsRow ? [settingsRow] : [])
				})
			})
		})
	},
	settings: { key: 'key' }
}));
mock.module('drizzle-orm', () => ({ eq: () => ({}) }));

const { runVolumeAutoscaling } = await import('~/modules/worker/jobs/platform/volume-autoscaling/job');

afterEach(() => {
	settingsRow = null;
});

const GI = 1024 ** 3;
const NAMESPACE = 'kubwave';
const REGISTRY_PVC_NAME = 'kubwave-registry-data';
const PROMETHEUS_PVC_NAME = 'kubwave-prometheus-data';
const REGISTRY_POD_NAME = 'kubwave-registry-abc';

// Shape isNotFound() recognizes (packages/kube/src/index.ts).
const notFound = () => ({ code: 404 });

function buildRegistryPvc(size: string, annotations: Record<string, string> = {}): V1PersistentVolumeClaim {
	return {
		metadata: { name: REGISTRY_PVC_NAME, namespace: NAMESPACE, uid: 'registry-pvc-uid', annotations: { ...annotations } },
		spec: { storageClassName: 'standard', resources: { requests: { storage: size } } },
		status: { capacity: { storage: size } }
	};
}

interface FakeClusterOptions {
	registryPvc: V1PersistentVolumeClaim;
	allowExpansion: boolean;
	usedBytes: number;
	capacityBytes: number;
}

// One combined fake implementing every method the sweep uses; every call is recorded.
function buildFakeCluster(opts: FakeClusterOptions) {
	const state = { registryPvc: structuredClone(opts.registryPvc) };
	const calls: string[] = [];
	const readPvcNames: string[] = [];
	const replacedPvcs: V1PersistentVolumeClaim[] = [];
	const events: CoreV1Event[] = [];
	const counters = { makeApiClient: 0 };

	const fake = {
		readNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
			calls.push('readNamespacedPersistentVolumeClaim');
			readPvcNames.push(name);
			if (name !== REGISTRY_PVC_NAME) throw notFound();
			return structuredClone(state.registryPvc);
		},
		listNamespacedPod: async ({ labelSelector }: { labelSelector?: string }) => {
			calls.push('listNamespacedPod');
			if (labelSelector === 'app.kubernetes.io/name=registry') {
				return { items: [{ metadata: { name: REGISTRY_POD_NAME }, spec: { nodeName: 'node-a' } }] };
			}
			return { items: [] };
		},
		listNamespacedPersistentVolumeClaim: async () => {
			calls.push('listNamespacedPersistentVolumeClaim');
			return { items: [] };
		},
		replaceNamespacedPersistentVolumeClaim: async ({ body }: { body: V1PersistentVolumeClaim }) => {
			calls.push('replaceNamespacedPersistentVolumeClaim');
			replacedPvcs.push(body);
			state.registryPvc = structuredClone(body);
			return body;
		},
		createNamespacedEvent: async ({ body }: { body: CoreV1Event }) => {
			calls.push('createNamespacedEvent');
			events.push(body);
			return body;
		},
		// nodeStatsSummary JSON-parses string results and passes objects through.
		connectGetNodeProxyWithPath: async () => {
			calls.push('connectGetNodeProxyWithPath');
			return {
				pods: [
					{
						podRef: { name: REGISTRY_POD_NAME, namespace: NAMESPACE },
						volume: [
							{
								pvcRef: { name: REGISTRY_PVC_NAME, namespace: NAMESPACE },
								usedBytes: opts.usedBytes,
								capacityBytes: opts.capacityBytes
							}
						]
					}
				]
			};
		},
		// CNPG Cluster 404 → postgres half is a no-op.
		getNamespacedCustomObject: async () => {
			calls.push('getNamespacedCustomObject');
			throw notFound();
		},
		replaceNamespacedCustomObject: async () => {
			calls.push('replaceNamespacedCustomObject');
			throw new Error('replaceNamespacedCustomObject must not be called');
		},
		readStorageClass: async () => {
			calls.push('readStorageClass');
			return { allowVolumeExpansion: opts.allowExpansion };
		}
	};

	const kc = {
		makeApiClient: () => {
			counters.makeApiClient += 1;
			return fake;
		}
	} as unknown as KubeConfig;

	return { kc, calls, counters, readPvcNames, replacedPvcs, events, state };
}

describe('runVolumeAutoscaling — disabled', () => {
	test('resolves without touching the cluster when no settings row exists', async () => {
		settingsRow = null;
		const cluster = buildFakeCluster({ registryPvc: buildRegistryPvc('20Gi'), allowExpansion: true, usedBytes: 18 * GI, capacityBytes: 20 * GI });

		await expect(runVolumeAutoscaling(cluster.kc)).resolves.toBeUndefined();

		expect(cluster.counters.makeApiClient).toBe(0);
		expect(cluster.calls).toEqual([]);
	});

	test('resolves without touching the cluster when the row disables autoscaling', async () => {
		settingsRow = { value: { enabled: false } };
		const cluster = buildFakeCluster({ registryPvc: buildRegistryPvc('20Gi'), allowExpansion: true, usedBytes: 18 * GI, capacityBytes: 20 * GI });

		await expect(runVolumeAutoscaling(cluster.kc)).resolves.toBeUndefined();

		expect(cluster.counters.makeApiClient).toBe(0);
		expect(cluster.calls).toEqual([]);
	});
});

describe('runVolumeAutoscaling — registry expansion', () => {
	test('skips the prometheus PVC when the metrics provider is not managed', async () => {
		settingsRow = { value: { enabled: true, provider: 'live' } };
		const cluster = buildFakeCluster({ registryPvc: buildRegistryPvc('20Gi'), allowExpansion: true, usedBytes: 10 * GI, capacityBytes: 20 * GI });

		await runVolumeAutoscaling(cluster.kc);

		expect(cluster.readPvcNames).not.toContain(PROMETHEUS_PVC_NAME);
	});

	test('grows a 20Gi PVC at 90% usage to 30Gi and emits a Normal VolumeExpanded event', async () => {
		settingsRow = { value: { enabled: true } }; // defaults: threshold 80%, growth 50%, registry cap 200Gi
		const cluster = buildFakeCluster({ registryPvc: buildRegistryPvc('20Gi'), allowExpansion: true, usedBytes: 18 * GI, capacityBytes: 20 * GI });

		await runVolumeAutoscaling(cluster.kc);

		expect(cluster.replacedPvcs).toHaveLength(1);
		const replaced = cluster.replacedPvcs[0]!;
		expect(replaced.spec?.resources?.requests?.storage).toBe('30Gi');
		expect(replaced.metadata?.annotations?.[LAST_EXPANDED_ANNOTATION]).toBeString();
		expect(Number.isFinite(Date.parse(replaced.metadata?.annotations?.[LAST_EXPANDED_ANNOTATION] ?? ''))).toBe(true);
		expect(replaced.metadata?.annotations?.[AT_CAP_REPORTED_ANNOTATION]).toBeUndefined();

		expect(cluster.events).toHaveLength(1);
		const event = cluster.events[0]!;
		expect(event.type).toBe('Normal');
		expect(event.reason).toBe('VolumeExpanded');
		expect(event.involvedObject?.kind).toBe('PersistentVolumeClaim');
		expect(event.involvedObject?.name).toBe(REGISTRY_PVC_NAME);

		expect(cluster.calls).toContain('getNamespacedCustomObject');
		expect(cluster.calls).not.toContain('replaceNamespacedCustomObject');
	});

	test('at the cap: warns once per size, then stays silent on the next sweep', async () => {
		settingsRow = { value: { enabled: true, caps: { registry: '20Gi' } } };
		const cluster = buildFakeCluster({ registryPvc: buildRegistryPvc('20Gi'), allowExpansion: true, usedBytes: 18 * GI, capacityBytes: 20 * GI });

		// First sweep: the only write marks the at-cap size as reported + one Warning event.
		await runVolumeAutoscaling(cluster.kc);

		expect(cluster.replacedPvcs).toHaveLength(1);
		const replaced = cluster.replacedPvcs[0]!;
		expect(replaced.spec?.resources?.requests?.storage).toBe('20Gi'); // never grown past the cap
		expect(replaced.metadata?.annotations?.[AT_CAP_REPORTED_ANNOTATION]).toBe('20Gi');
		expect(replaced.metadata?.annotations?.[LAST_EXPANDED_ANNOTATION]).toBeUndefined();

		expect(cluster.events).toHaveLength(1);
		expect(cluster.events[0]!.type).toBe('Warning');
		expect(cluster.events[0]!.reason).toBe('VolumeAtCap');

		// Second sweep sees the annotation already matching the size: no replace, no event.
		await runVolumeAutoscaling(cluster.kc);

		expect(cluster.replacedPvcs).toHaveLength(1);
		expect(cluster.events).toHaveLength(1);
	});

	test('does nothing when the StorageClass does not allow expansion', async () => {
		settingsRow = { value: { enabled: true } };
		const cluster = buildFakeCluster({ registryPvc: buildRegistryPvc('20Gi'), allowExpansion: false, usedBytes: 18 * GI, capacityBytes: 20 * GI });

		await runVolumeAutoscaling(cluster.kc);

		expect(cluster.calls).toContain('readStorageClass');
		expect(cluster.calls).not.toContain('replaceNamespacedPersistentVolumeClaim');
		expect(cluster.calls).not.toContain('createNamespacedEvent');
		expect(cluster.replacedPvcs).toHaveLength(0);
		expect(cluster.events).toHaveLength(0);
	});
});
