import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { AppsV1Api, CoreV1Api, KubeConfig, V1ConfigMap, V1Deployment } from '@kubernetes/client-node';

// reconcile reads metrics-provider via a dynamic db import; each test points settingsRow at the row.
let settingsRow: { value: unknown } | null = null;

mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		storageClassName: '',
		prometheusImage: 'prom/prometheus:test',
		prometheusRetention: '7d',
		prometheusStorageSize: '5Gi'
	}
}));
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

const {
	PROMETHEUS_NAME,
	buildPrometheusConfig,
	buildPrometheusDeployment,
	buildPrometheusPVC,
	buildPrometheusService,
	prometheusEnabled,
	providerFromRow,
	retentionSizeArg,
	reconcilePlatformPrometheus
} = await import('~/modules/worker/jobs/platform/prometheus');

afterEach(() => {
	settingsRow = null;
});

describe('prometheusEnabled', () => {
	test('only the managed provider enables the platform Prometheus', () => {
		expect(prometheusEnabled('prometheus-managed')).toBe(true);
		expect(prometheusEnabled('prometheus-external')).toBe(false);
		expect(prometheusEnabled('live')).toBe(false);
		expect(prometheusEnabled(undefined)).toBe(false);
	});
});

describe('providerFromRow', () => {
	test('an unset provider defaults to live, so a fresh install provisions no Prometheus', () => {
		expect(providerFromRow(undefined)).toBe('live');
		expect(providerFromRow({})).toBe('live');
	});

	test('an explicit provider is preserved', () => {
		expect(providerFromRow({ provider: 'live' })).toBe('live');
		expect(providerFromRow({ provider: 'prometheus-external' })).toBe('prometheus-external');
	});
});

describe('buildPrometheusConfig', () => {
	test('scrapes cAdvisor and the kubelet through the apiserver node proxy', () => {
		const cfg = buildPrometheusConfig();
		expect(cfg).toContain('job_name: kubernetes-cadvisor');
		expect(cfg).toContain('job_name: kubernetes-kubelet');
		expect(cfg).toContain('/api/v1/nodes/${1}/proxy/metrics/cadvisor');
		expect(cfg).toContain('/api/v1/nodes/${1}/proxy/metrics');
	});
});

describe('buildPrometheusDeployment', () => {
	test('runs as the static ServiceAccount with config + data volumes and retention', () => {
		const dep = buildPrometheusDeployment('kubwave', 'prom/prometheus:test');
		expect(dep.metadata?.name).toBe(PROMETHEUS_NAME);
		expect(dep.metadata?.namespace).toBe('kubwave');
		const spec = dep.spec?.template?.spec;
		expect(spec?.serviceAccountName).toBe('kubwave-prometheus');
		const container = spec?.containers?.[0];
		expect(container?.image).toBe('prom/prometheus:test');
		expect(container?.args?.some(a => a.startsWith('--storage.tsdb.retention.time='))).toBe(true);
		expect((container?.volumeMounts ?? []).map(v => v.mountPath).sort()).toEqual(['/etc/prometheus', '/prometheus']);
		// Single writer against one RWO TSDB volume.
		expect(dep.spec?.strategy?.type).toBe('Recreate');
		expect(dep.spec?.replicas).toBe(1);
	});

	test('carries a spec-hash annotation that changes with the image so reconcile rolls the pod', () => {
		const a = buildPrometheusDeployment('kubwave', 'prom/prometheus:a');
		const b = buildPrometheusDeployment('kubwave', 'prom/prometheus:b');
		const hashA = a.spec?.template?.metadata?.annotations?.['kubwave/config-hash'];
		const hashB = b.spec?.template?.metadata?.annotations?.['kubwave/config-hash'];
		expect(hashA).toBeTruthy();
		expect(hashA).not.toBe(hashB);
		// Same inputs → same hash, so an unchanged spec never churns the Deployment.
		expect(buildPrometheusDeployment('kubwave', 'prom/prometheus:a').spec?.template?.metadata?.annotations?.['kubwave/config-hash']).toBe(hashA);
	});
});

describe('buildPrometheusService', () => {
	test('exposes 9090 and selects the Prometheus pods', () => {
		const svc = buildPrometheusService('kubwave');
		expect(svc.metadata?.name).toBe(PROMETHEUS_NAME);
		expect(svc.spec?.ports?.[0]?.port).toBe(9090);
		expect(svc.spec?.selector?.['app.kubernetes.io/name']).toBe(PROMETHEUS_NAME);
	});
});

describe('buildPrometheusPVC', () => {
	test('omits storageClassName when empty (cluster default), sets it otherwise', () => {
		expect(buildPrometheusPVC('kubwave', '').spec?.storageClassName).toBeUndefined();
		expect(buildPrometheusPVC('kubwave', 'fast').spec?.storageClassName).toBe('fast');
	});
});

describe('retentionSizeArg', () => {
	test('80% of the PVC size, floored to MiB (5Gi default → 4096MiB)', () => {
		expect(retentionSizeArg('5Gi')).toBe('--storage.tsdb.retention.size=4096MiB');
		expect(retentionSizeArg('10Gi')).toBe('--storage.tsdb.retention.size=8192MiB');
	});

	test('unparseable size → null (no arg, Prometheus falls back to retention.time only)', () => {
		expect(retentionSizeArg('')).toBeNull();
		expect(retentionSizeArg('bogus')).toBeNull();
	});
});

describe('prometheus deployment args', () => {
	test('carries the retention.size cap so the TSDB can never fill the volume', () => {
		const args = buildPrometheusDeployment('kubwave').spec?.template?.spec?.containers?.[0]?.args ?? [];
		expect(args).toContain('--storage.tsdb.retention.size=4096MiB');
	});
});

// reconcilePlatformPrometheus: IO reconciler with mocked DB/env + fake k8s clients; builders run for real.

const notFound = () => ({ code: 404 });
const CONFIG_NAME = 'kubwave-prometheus-config';
const PVC_NAME = 'kubwave-prometheus-data';

interface FakeOptions {
	deployment?: V1Deployment | null;
	configMap?: V1ConfigMap | null;
	pvc?: boolean;
	service?: boolean;
}

function buildFakePrometheus(opts: FakeOptions = {}) {
	const calls: string[] = [];
	const state = {
		deployment: opts.deployment ?? null,
		configMap: opts.configMap ?? null,
		pvc: opts.pvc ?? false,
		service: opts.service ?? false
	};

	const appsApi = {
		readNamespacedDeployment: async () => {
			calls.push('readDeployment');
			if (!state.deployment) throw notFound();
			return structuredClone(state.deployment);
		},
		createNamespacedDeployment: async ({ body }: { body: V1Deployment }) => {
			calls.push('createDeployment');
			state.deployment = structuredClone(body);
			return body;
		},
		replaceNamespacedDeployment: async ({ body }: { body: V1Deployment }) => {
			calls.push('replaceDeployment');
			state.deployment = structuredClone(body);
			return body;
		},
		deleteNamespacedDeployment: async () => {
			calls.push('deleteDeployment');
			state.deployment = null;
		}
	} as unknown as AppsV1Api;

	const coreApi = {
		readNamespacedConfigMap: async () => {
			calls.push('readConfigMap');
			if (!state.configMap) throw notFound();
			return structuredClone(state.configMap);
		},
		createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => {
			calls.push('createConfigMap');
			state.configMap = structuredClone(body);
			return body;
		},
		replaceNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => {
			calls.push('replaceConfigMap');
			state.configMap = structuredClone(body);
			return body;
		},
		deleteNamespacedConfigMap: async () => {
			calls.push('deleteConfigMap');
			state.configMap = null;
		},
		readNamespacedPersistentVolumeClaim: async () => {
			calls.push('readPVC');
			if (!state.pvc) throw notFound();
			return { metadata: { name: PVC_NAME } };
		},
		createNamespacedPersistentVolumeClaim: async () => {
			calls.push('createPVC');
			state.pvc = true;
		},
		deleteNamespacedPersistentVolumeClaim: async () => {
			calls.push('deletePVC');
			state.pvc = false;
		},
		readNamespacedService: async () => {
			calls.push('readService');
			if (!state.service) throw notFound();
			return { metadata: { name: PROMETHEUS_NAME } };
		},
		createNamespacedService: async () => {
			calls.push('createService');
			state.service = true;
		},
		deleteNamespacedService: async () => {
			calls.push('deleteService');
			state.service = false;
		}
	} as unknown as CoreV1Api;

	const kc = {
		makeApiClient: (ctor: unknown) => ((ctor as { name?: string }).name?.includes('AppsV1Api') ? appsApi : coreApi)
	} as unknown as KubeConfig;

	return { kc, calls, state };
}

describe('reconcilePlatformPrometheus — disabled / teardown', () => {
	test('live provider with nothing provisioned: probes but never deletes', async () => {
		settingsRow = { value: { provider: 'live' } };
		const fake = buildFakePrometheus(); // nothing exists

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toContain('readDeployment');
		expect(fake.calls).toContain('readConfigMap'); // second probe since Deployment absent
		expect(fake.calls.some(c => c.startsWith('delete'))).toBe(false);
		expect(fake.calls.some(c => c.startsWith('create'))).toBe(false);
	});

	test('unset provider defaults to live (no managed Prometheus on a fresh install)', async () => {
		settingsRow = null;
		const fake = buildFakePrometheus();

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls.some(c => c.startsWith('create'))).toBe(false);
	});

	test('switching away from managed tears down all four resources', async () => {
		settingsRow = { value: { provider: 'prometheus-external' } };
		const fake = buildFakePrometheus({
			deployment: { metadata: { name: PROMETHEUS_NAME } } as V1Deployment,
			configMap: { metadata: { name: CONFIG_NAME } },
			pvc: true,
			service: true
		});

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toEqual(expect.arrayContaining(['deleteDeployment', 'deleteService', 'deleteConfigMap', 'deletePVC']));
	});

	test('teardown probe short-circuits on a present ConfigMap even without a Deployment', async () => {
		settingsRow = { value: { provider: 'live' } };
		const fake = buildFakePrometheus({ configMap: { metadata: { name: CONFIG_NAME } } });

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toContain('deleteConfigMap'); // provisioned → tears down
	});
});

describe('reconcilePlatformPrometheus — managed convergence', () => {
	test('fresh managed install creates ConfigMap, PVC, Service and Deployment', async () => {
		settingsRow = { value: { provider: 'prometheus-managed' } };
		const fake = buildFakePrometheus(); // nothing exists yet

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toContain('createConfigMap');
		expect(fake.calls).toContain('createPVC');
		expect(fake.calls).toContain('createService');
		expect(fake.calls).toContain('createDeployment');
		expect(fake.calls).not.toContain('deleteDeployment');
	});

	test('an existing ConfigMap is replaced (scrape-config edits apply); existing PVC/Service are left alone', async () => {
		settingsRow = { value: { provider: 'prometheus-managed' } };
		const fake = buildFakePrometheus({ configMap: { metadata: { name: CONFIG_NAME, resourceVersion: '7' } }, pvc: true, service: true });

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toContain('replaceConfigMap');
		expect(fake.calls).not.toContain('createPVC'); // already present
		expect(fake.calls).not.toContain('createService');
	});

	test('an unchanged Deployment spec-hash skips the replace (no generation churn)', async () => {
		settingsRow = { value: { provider: 'prometheus-managed' } };
		// Build the desired Deployment so its hash matches what reconcile computes.
		const desired = buildPrometheusDeployment('kubwave', 'prom/prometheus:test');
		const fake = buildFakePrometheus({
			configMap: { metadata: { name: CONFIG_NAME, resourceVersion: '1' } },
			pvc: true,
			service: true,
			deployment: desired
		});

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toContain('readDeployment');
		expect(fake.calls).not.toContain('replaceDeployment');
		expect(fake.calls).not.toContain('createDeployment');
	});

	test('a drifted Deployment spec-hash (e.g. old image) is replaced to roll the pod', async () => {
		settingsRow = { value: { provider: 'prometheus-managed' } };
		// Hash baked from a different image → mismatch → replace.
		const stale = buildPrometheusDeployment('kubwave', 'prom/prometheus:OLD');
		const fake = buildFakePrometheus({
			configMap: { metadata: { name: CONFIG_NAME, resourceVersion: '1' } },
			pvc: true,
			service: true,
			deployment: stale
		});

		await reconcilePlatformPrometheus(fake.kc);

		expect(fake.calls).toContain('replaceDeployment');
	});
});
