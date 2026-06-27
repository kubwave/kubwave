import { describe, expect, test } from 'bun:test';
import type { CoreV1Api, CoreV1Event, StorageV1Api, V1PersistentVolumeClaim } from '@kubernetes/client-node';
import { PROMETHEUS_POD_SELECTOR, PROMETHEUS_PVC_NAME, type NodeStatsSummary } from '@kubwave/kube';
import { reconcilePrometheusVolume } from '~/modules/worker/jobs/platform/volume-autoscaling/prometheus';
import { AT_CAP_REPORTED_ANNOTATION, LAST_EXPANDED_ANNOTATION } from '~/modules/worker/jobs/platform/volume-autoscaling/decide';

const GI = 1024 ** 3;
const NAMESPACE = 'kubwave';
const POD_NAME = 'kubwave-prometheus-abc';

const defaultConfig = {
	enabled: true,
	thresholdPercent: 80,
	growthPercent: 50,
	caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
};

const notFound = () => ({ code: 404 });

function pvc(size: string, annotations: Record<string, string> = {}): V1PersistentVolumeClaim {
	return {
		metadata: { name: PROMETHEUS_PVC_NAME, namespace: NAMESPACE, uid: 'prom-pvc-uid', annotations: { ...annotations } },
		spec: { storageClassName: 'standard', resources: { requests: { storage: size } } },
		status: { capacity: { storage: size } }
	};
}

function buildFake(opts: { pvc: V1PersistentVolumeClaim | null; allowExpansion?: boolean; usedBytes?: number; capacityBytes?: number }) {
	const state = { pvc: opts.pvc ? structuredClone(opts.pvc) : null };
	const calls: string[] = [];
	const replacedPvcs: V1PersistentVolumeClaim[] = [];
	const events: CoreV1Event[] = [];

	const coreApi = {
		readNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
			calls.push('readNamespacedPersistentVolumeClaim');
			if (name !== PROMETHEUS_PVC_NAME || !state.pvc) throw notFound();
			return structuredClone(state.pvc);
		},
		listNamespacedPod: async ({ labelSelector }: { labelSelector?: string }) => {
			calls.push('listNamespacedPod');
			if (labelSelector !== PROMETHEUS_POD_SELECTOR) return { items: [] };
			return { items: [{ metadata: { name: POD_NAME }, spec: { nodeName: 'node-a' } }] };
		},
		connectGetNodeProxyWithPath: async (): Promise<NodeStatsSummary> => {
			calls.push('connectGetNodeProxyWithPath');
			return {
				pods: [
					{
						podRef: { name: POD_NAME, namespace: NAMESPACE },
						volume: [
							{
								pvcRef: { name: PROMETHEUS_PVC_NAME, namespace: NAMESPACE },
								usedBytes: opts.usedBytes ?? Math.round(4.5 * GI),
								capacityBytes: opts.capacityBytes ?? 5 * GI
							}
						]
					}
				]
			};
		},
		replaceNamespacedPersistentVolumeClaim: async ({ body }: { body: V1PersistentVolumeClaim }) => {
			calls.push('replaceNamespacedPersistentVolumeClaim');
			replacedPvcs.push(body);
			state.pvc = structuredClone(body);
			return body;
		},
		createNamespacedEvent: async ({ body }: { body: CoreV1Event }) => {
			calls.push('createNamespacedEvent');
			events.push(body);
			return body;
		}
	} as unknown as CoreV1Api;

	const storageApi = {
		readStorageClass: async () => {
			calls.push('readStorageClass');
			return { allowVolumeExpansion: opts.allowExpansion ?? true };
		}
	} as unknown as StorageV1Api;

	return { coreApi, storageApi, calls, replacedPvcs, events, state };
}

async function run(fake: ReturnType<typeof buildFake>, config = defaultConfig) {
	await reconcilePrometheusVolume(fake.coreApi, fake.storageApi, NAMESPACE, config, new Map());
}

describe('reconcilePrometheusVolume', () => {
	test('grows a 5Gi PVC at 90% usage to 8Gi and emits a Normal VolumeExpanded event', async () => {
		const fake = buildFake({ pvc: pvc('5Gi') });

		await run(fake);

		expect(fake.replacedPvcs).toHaveLength(1);
		const replaced = fake.replacedPvcs[0]!;
		expect(replaced.spec?.resources?.requests?.storage).toBe('8Gi');
		expect(Number.isFinite(Date.parse(replaced.metadata?.annotations?.[LAST_EXPANDED_ANNOTATION] ?? ''))).toBe(true);
		expect(replaced.metadata?.annotations?.[AT_CAP_REPORTED_ANNOTATION]).toBeUndefined();
		expect(fake.events).toHaveLength(1);
		expect(fake.events[0]!.type).toBe('Normal');
		expect(fake.events[0]!.reason).toBe('VolumeExpanded');
		expect(fake.events[0]!.involvedObject?.name).toBe(PROMETHEUS_PVC_NAME);
	});

	test('at the cap: warns once per size, then stays silent on the next sweep', async () => {
		const fake = buildFake({ pvc: pvc('5Gi') });
		const config = { ...defaultConfig, caps: { ...defaultConfig.caps, prometheus: '5Gi' } };

		await run(fake, config);

		expect(fake.replacedPvcs).toHaveLength(1);
		expect(fake.replacedPvcs[0]!.metadata?.annotations?.[AT_CAP_REPORTED_ANNOTATION]).toBe('5Gi');
		expect(fake.events).toHaveLength(1);
		expect(fake.events[0]!.type).toBe('Warning');
		expect(fake.events[0]!.reason).toBe('VolumeAtCap');

		await run(fake, config);

		expect(fake.replacedPvcs).toHaveLength(1);
		expect(fake.events).toHaveLength(1);
	});

	test('is a no-op when managed Prometheus has no PVC yet', async () => {
		const fake = buildFake({ pvc: null });

		await run(fake);

		expect(fake.calls).toEqual(['readNamespacedPersistentVolumeClaim']);
		expect(fake.replacedPvcs).toHaveLength(0);
		expect(fake.events).toHaveLength(0);
	});
});
