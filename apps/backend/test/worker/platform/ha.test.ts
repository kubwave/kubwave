import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { AppsV1Api, CoreV1Api, CustomObjectsApi, KubeConfig, V1ConfigMap, V1Deployment } from '@kubernetes/client-node';
import { clusterHaDrift, deploymentHaDrift, desiredReplicas, haAffinity, haTopologySpread } from '~/modules/worker/jobs/platform/ha';

describe('desiredReplicas', () => {
	test('3 when HA on, 1 when off', () => {
		expect(desiredReplicas(true)).toBe(3);
		expect(desiredReplicas(false)).toBe(1);
	});
});

describe('haAffinity / haTopologySpread', () => {
	test('soft podAntiAffinity on the hostname topology, selecting the component', () => {
		const term = haAffinity('api').podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution?.[0];
		expect(term?.weight).toBe(100);
		expect(term?.podAffinityTerm?.topologyKey).toBe('kubernetes.io/hostname');
		expect(term?.podAffinityTerm?.labelSelector?.matchLabels?.['app.kubernetes.io/name']).toBe('api');
	});

	test('soft topologySpread (ScheduleAnyway) on the hostname topology', () => {
		const [constraint] = haTopologySpread('console');
		expect(constraint?.whenUnsatisfiable).toBe('ScheduleAnyway');
		expect(constraint?.topologyKey).toBe('kubernetes.io/hostname');
		expect(constraint?.maxSkew).toBe(1);
		expect(constraint?.labelSelector?.matchLabels?.['app.kubernetes.io/name']).toBe('console');
	});
});

describe('deploymentHaDrift', () => {
	const dep = (replicas: number, withSpread: boolean): V1Deployment =>
		({
			spec: {
				replicas,
				template: { spec: withSpread ? { affinity: haAffinity('api'), topologySpreadConstraints: haTopologySpread('api') } : {} }
			}
		}) as V1Deployment;

	test('converged states report no drift (the idempotent write-gate)', () => {
		expect(deploymentHaDrift(dep(3, true), true)).toBe(false);
		expect(deploymentHaDrift(dep(1, false), false)).toBe(false);
	});

	test('a wrong replica count is drift', () => {
		expect(deploymentHaDrift(dep(1, true), true)).toBe(true);
		expect(deploymentHaDrift(dep(3, false), false)).toBe(true);
	});

	test('missing spread under HA, or lingering spread when off, is drift', () => {
		expect(deploymentHaDrift(dep(3, false), true)).toBe(true);
		expect(deploymentHaDrift(dep(1, true), false)).toBe(true);
	});
});

describe('clusterHaDrift', () => {
	const cluster = (instances: number, antiAffinity: boolean) => ({ spec: { instances, affinity: { enablePodAntiAffinity: antiAffinity } } });

	test('converged states report no drift', () => {
		expect(clusterHaDrift(cluster(3, true), true)).toBe(false);
		expect(clusterHaDrift(cluster(1, false), false)).toBe(false);
	});

	test('wrong instance count is drift', () => {
		expect(clusterHaDrift(cluster(1, true), true)).toBe(true);
		expect(clusterHaDrift(cluster(3, false), false)).toBe(true);
	});

	test('instances right but anti-affinity wrong is drift (3 co-locatable instances is not HA)', () => {
		expect(clusterHaDrift(cluster(3, false), true)).toBe(true);
		expect(clusterHaDrift(cluster(1, true), false)).toBe(true);
	});

	test('defaults: missing spec/affinity reads as instances=1, anti-affinity=false', () => {
		expect(clusterHaDrift({}, false)).toBe(false);
		expect(clusterHaDrift({}, true)).toBe(true);
		expect(clusterHaDrift({ spec: { instances: 3 } }, true)).toBe(true); // affinity absent → still drift
	});
});

// reconcileHaMode: IO reconciler with mocked DB/env + fake k8s clients; the drift helpers run for real.

// The `ha` setting is read via a dynamic `await import('@kubwave/db')` select chain.
let haSettingRow: { value: unknown } | null = null;

mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));
mock.module('@kubwave/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (haSettingRow ? [haSettingRow] : [])
				})
			})
		})
	},
	settings: { key: 'key' }
}));
mock.module('drizzle-orm', () => ({ eq: () => ({}) }));

const { reconcileHaMode } = await import('~/modules/worker/jobs/platform/ha');

afterEach(() => {
	haSettingRow = null;
});

const notFound = () => ({ code: 404 });
const conflict = () => ({ code: 409 });
const PLATFORM_CM = 'kubwave-platform';

interface FakeHaOptions {
	// Deployments keyed by name; absent → 404 on read.
	deployments: Record<string, V1Deployment | undefined>;
	// CNPG Cluster, or null → getNamespacedCustomObject throws 404.
	cluster: Record<string, unknown> | null;
	// Platform marker ConfigMap, or null → read returns 404.
	configMap: V1ConfigMap | null;
}

function buildFakeHa(opts: FakeHaOptions) {
	const calls: string[] = [];
	const replacedDeployments: V1Deployment[] = [];
	const replacedClusters: Record<string, unknown>[] = [];
	const replacedConfigMaps: V1ConfigMap[] = [];
	const state = { deployments: { ...opts.deployments }, cluster: opts.cluster, configMap: opts.configMap };

	const appsApi = {
		readNamespacedDeployment: async ({ name }: { name: string }) => {
			calls.push(`readDeployment:${name}`);
			const dep = state.deployments[name];
			if (!dep) throw notFound();
			return structuredClone(dep);
		},
		replaceNamespacedDeployment: async ({ name, body }: { name: string; body: V1Deployment }) => {
			calls.push(`replaceDeployment:${name}`);
			replacedDeployments.push(body);
			state.deployments[name] = structuredClone(body);
			return body;
		}
	} as unknown as AppsV1Api;

	const coreApi = {
		readNamespacedConfigMap: async () => {
			calls.push('readConfigMap');
			if (!state.configMap) throw notFound();
			return structuredClone(state.configMap);
		},
		replaceNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => {
			calls.push('replaceConfigMap');
			replacedConfigMaps.push(body);
			state.configMap = structuredClone(body);
			return body;
		}
	} as unknown as CoreV1Api;

	const customApi = {
		getNamespacedCustomObject: async () => {
			calls.push('getCluster');
			if (!state.cluster) throw notFound();
			return structuredClone(state.cluster);
		},
		replaceNamespacedCustomObject: async ({ body }: { body: Record<string, unknown> }) => {
			calls.push('replaceCluster');
			replacedClusters.push(body);
			state.cluster = structuredClone(body);
			return body;
		}
	} as unknown as CustomObjectsApi;

	const kc = {
		makeApiClient: (ctor: unknown) => {
			const name = (ctor as { name?: string }).name ?? '';
			if (name.includes('AppsV1Api')) return appsApi;
			if (name.includes('CoreV1Api')) return coreApi;
			return customApi;
		}
	} as unknown as KubeConfig;

	return { kc, calls, replacedDeployments, replacedClusters, replacedConfigMaps, state };
}

const dep = (replicas: number, withSpread: boolean): V1Deployment =>
	({
		spec: {
			replicas,
			template: { spec: withSpread ? { affinity: haAffinity('api'), topologySpreadConstraints: haTopologySpread('api') } : {} }
		}
	}) as V1Deployment;

const cm = (haEnabled?: string): V1ConfigMap => ({ metadata: { name: PLATFORM_CM }, data: haEnabled === undefined ? {} : { ha_enabled: haEnabled } });

describe('reconcileHaMode', () => {
	test('HA on: scales drifted Deployments to 3 + spread, scales the Cluster, and flips the marker', async () => {
		haSettingRow = { value: { enabled: true } };
		const fake = buildFakeHa({
			deployments: { api: dep(1, false), console: dep(1, false) },
			cluster: { metadata: { uid: 'c1' }, spec: { instances: 1, affinity: { enablePodAntiAffinity: false } } },
			configMap: cm('false')
		});

		await reconcileHaMode(fake.kc);

		// marker first, then both peers, then the Cluster
		expect(fake.replacedConfigMaps).toHaveLength(1);
		expect(fake.replacedConfigMaps[0]!.data?.['ha_enabled']).toBe('true');
		expect(fake.replacedDeployments).toHaveLength(2);
		for (const d of fake.replacedDeployments) {
			expect(d.spec?.replicas).toBe(3);
			expect(d.spec?.template?.spec?.affinity?.podAntiAffinity).toBeTruthy();
			expect((d.spec?.template?.spec?.topologySpreadConstraints ?? []).length).toBeGreaterThan(0);
		}
		expect(fake.replacedClusters).toHaveLength(1);
		const cluster = fake.replacedClusters[0]! as { spec: { instances: number; affinity: { enablePodAntiAffinity: boolean; topologyKey: string } } };
		expect(cluster.spec.instances).toBe(3);
		expect(cluster.spec.affinity.enablePodAntiAffinity).toBe(true);
		expect(cluster.spec.affinity.topologyKey).toBe('kubernetes.io/hostname');
	});

	test('HA off: scales back to 1 and drops spread/anti-affinity on drifted objects', async () => {
		haSettingRow = { value: { enabled: false } };
		const fake = buildFakeHa({
			deployments: { api: dep(3, true), console: dep(3, true) },
			cluster: { spec: { instances: 3, affinity: { enablePodAntiAffinity: true } } },
			configMap: cm('true')
		});

		await reconcileHaMode(fake.kc);

		expect(fake.replacedConfigMaps[0]!.data?.['ha_enabled']).toBe('false');
		for (const d of fake.replacedDeployments) {
			expect(d.spec?.replicas).toBe(1);
			expect(d.spec?.template?.spec?.affinity).toBeUndefined();
			expect(d.spec?.template?.spec?.topologySpreadConstraints).toBeUndefined();
		}
		expect((fake.replacedClusters[0]! as { spec: { affinity: { enablePodAntiAffinity: boolean } } }).spec.affinity.enablePodAntiAffinity).toBe(false);
	});

	test('an unset settings row defaults to disabled (no drift on a fresh 1-replica install → no writes)', async () => {
		haSettingRow = null;
		const fake = buildFakeHa({
			deployments: { api: dep(1, false), console: dep(1, false) },
			cluster: { spec: { instances: 1, affinity: { enablePodAntiAffinity: false } } },
			configMap: cm('false')
		});

		await reconcileHaMode(fake.kc);

		expect(fake.replacedDeployments).toHaveLength(0);
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.replacedConfigMaps).toHaveLength(0); // marker already 'false'
	});

	test('already-converged HA state writes nothing (idempotent)', async () => {
		haSettingRow = { value: { enabled: true } };
		const fake = buildFakeHa({
			deployments: { api: dep(3, true), console: dep(3, true) },
			cluster: { spec: { instances: 3, affinity: { enablePodAntiAffinity: true } } },
			configMap: cm('true')
		});

		await reconcileHaMode(fake.kc);

		expect(fake.replacedDeployments).toHaveLength(0);
		expect(fake.replacedClusters).toHaveLength(0);
		expect(fake.replacedConfigMaps).toHaveLength(0);
	});

	test('a not-yet-deployed Deployment (404) is skipped for the next tick, not an error', async () => {
		haSettingRow = { value: { enabled: true } };
		const fake = buildFakeHa({
			deployments: { api: undefined, console: dep(1, false) }, // api not deployed yet
			cluster: { spec: { instances: 1, affinity: { enablePodAntiAffinity: false } } },
			configMap: cm('false')
		});

		await reconcileHaMode(fake.kc);

		expect(fake.replacedDeployments.map(() => 1)).toHaveLength(1);
		expect(fake.calls).toContain('readDeployment:api');
		expect(fake.calls).toContain('replaceDeployment:console');
	});

	test('an absent CNPG Cluster (external DB) makes the postgres half a no-op', async () => {
		haSettingRow = { value: { enabled: true } };
		const fake = buildFakeHa({
			deployments: { api: dep(3, true), console: dep(3, true) },
			cluster: null,
			configMap: cm('true')
		});

		await reconcileHaMode(fake.kc);

		expect(fake.calls).toContain('getCluster');
		expect(fake.replacedClusters).toHaveLength(0);
	});

	test('a missing platform marker (dev install) is nothing to mirror', async () => {
		haSettingRow = { value: { enabled: true } };
		const fake = buildFakeHa({
			deployments: { api: dep(3, true), console: dep(3, true) },
			cluster: { spec: { instances: 3, affinity: { enablePodAntiAffinity: true } } },
			configMap: null
		});

		await reconcileHaMode(fake.kc);

		expect(fake.calls).toContain('readConfigMap');
		expect(fake.replacedConfigMaps).toHaveLength(0);
	});

	test('Cluster replace retries on a 409 conflict and converges on the re-read', async () => {
		haSettingRow = { value: { enabled: true } };
		// First Cluster replace throws 409; retryOnConflict re-runs the whole attempt (re-read + replace).
		let throwOnce = true;
		const replacedClusters: Record<string, unknown>[] = [];
		const cluster: Record<string, unknown> = { spec: { instances: 1, affinity: { enablePodAntiAffinity: false } } };
		const noopApps = {
			readNamespacedDeployment: async () => ({ spec: { template: { spec: {} }, replicas: 3 } }),
			replaceNamespacedDeployment: async () => ({})
		};
		const noopCore = { readNamespacedConfigMap: async () => cm('true'), replaceNamespacedConfigMap: async () => ({}) };
		const customApi = {
			getNamespacedCustomObject: async () => structuredClone(cluster),
			replaceNamespacedCustomObject: async ({ body }: { body: Record<string, unknown> }) => {
				if (throwOnce) {
					throwOnce = false;
					throw conflict();
				}
				replacedClusters.push(body);
				return body;
			}
		};
		const kc = {
			makeApiClient: (ctor: unknown) => {
				const name = (ctor as { name?: string }).name ?? '';
				if (name.includes('AppsV1Api')) return noopApps;
				if (name.includes('CoreV1Api')) return noopCore;
				return customApi;
			}
		} as unknown as KubeConfig;

		await reconcileHaMode(kc);

		expect(replacedClusters).toHaveLength(1); // succeeded on the retry
	});
});
