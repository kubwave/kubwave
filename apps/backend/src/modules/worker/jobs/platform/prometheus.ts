import { createHash } from 'node:crypto';
import {
	AppsV1Api,
	CoreV1Api,
	type KubeConfig,
	type V1ConfigMap,
	type V1Deployment,
	type V1PersistentVolumeClaim,
	type V1Service
} from '@kubernetes/client-node';
import { DEFAULT_METRICS_PROVIDER, METRICS_SETTINGS_KEY, parseMemoryToBytes, PROMETHEUS_NAME, PROMETHEUS_PVC_NAME } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import {
	deleteIgnoreMissing,
	readConfigMapOrNull,
	readDeploymentOrNull,
	readPVCOrNull,
	readServiceOrNull,
	replaceWithRetry
} from '../../../../shared/cluster/ops.js';

// Platform-managed Prometheus: converge a single-replica stack scraping the kubelet via the apiserver node proxy; other providers tear it down.

const CONFIG_NAME = 'kubwave-prometheus-config';
const PVC_NAME = PROMETHEUS_PVC_NAME;
const SERVICE_ACCOUNT = 'kubwave-prometheus';
const PROMETHEUS_PORT = 9090;

export { PROMETHEUS_NAME };

// Spec-input hash (image, retention, scrape config) so reconcile rolls the pod only when it changes; an unchanged spec doesn't churn the generation.
const SPEC_HASH_ANNOTATION = 'kubwave/config-hash';

function labels(): Record<string, string> {
	return { 'app.kubernetes.io/name': PROMETHEUS_NAME, 'app.kubernetes.io/managed-by': 'kubwave-worker' };
}

export function retentionSizeArg(pvcSize: string): string | null {
	const bytes = parseMemoryToBytes(pvcSize);

	if (!bytes) return null;

	const mib = Math.floor((bytes * 0.8) / 1024 ** 2);

	return `--storage.tsdb.retention.size=${mib}MiB`;
}

function deploymentArgs(): string[] {
	const sizeArg = retentionSizeArg(env.prometheusStorageSize);
	return [
		'--config.file=/etc/prometheus/prometheus.yml',
		'--storage.tsdb.path=/prometheus',
		`--storage.tsdb.retention.time=${env.prometheusRetention}`,
		...(sizeArg ? [sizeArg] : []),
		'--web.enable-lifecycle'
	];
}

function specHash(image: string): string {
	const inputs = JSON.stringify({ image, args: deploymentArgs(), config: buildPrometheusConfig() });

	return createHash('sha256').update(inputs).digest('hex').slice(0, 16);
}

export function prometheusEnabled(provider: string | undefined): boolean {
	return provider === 'prometheus-managed';
}

export function providerFromRow(value: { provider?: string } | undefined): string {
	return value?.provider ?? DEFAULT_METRICS_PROVIDER;
}

export async function readMetricsProvider(): Promise<string> {
	// Lazy import so the pure builders above stay importable (and unit-testable) without a DB client.
	const { db, settings } = await import('@kubwave/db');
	const { eq } = await import('drizzle-orm');
	const [row] = await db.select().from(settings).where(eq(settings.key, METRICS_SETTINGS_KEY)).limit(1);

	return providerFromRow(row?.value as { provider?: string } | undefined);
}

// Scrapes kubelet via the apiserver node proxy: cAdvisor for CPU/mem/net, kubelet /metrics for PVC volume stats; both carry the labels the API's PromQL needs.
export function buildPrometheusConfig(): string {
	return [
		'global:',
		'  scrape_interval: 10s',
		'scrape_configs:',
		'  - job_name: kubernetes-cadvisor',
		'    scheme: https',
		'    tls_config:',
		'      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
		'      insecure_skip_verify: true',
		'    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token',
		'    kubernetes_sd_configs:',
		'      - role: node',
		'    relabel_configs:',
		'      - action: labelmap',
		'        regex: __meta_kubernetes_node_label_(.+)',
		'      - target_label: __address__',
		'        replacement: kubernetes.default.svc:443',
		'      - source_labels: [__meta_kubernetes_node_name]',
		'        regex: (.+)',
		'        target_label: __metrics_path__',
		'        replacement: /api/v1/nodes/${1}/proxy/metrics/cadvisor',
		'  - job_name: kubernetes-kubelet',
		'    scheme: https',
		'    tls_config:',
		'      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
		'      insecure_skip_verify: true',
		'    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token',
		'    kubernetes_sd_configs:',
		'      - role: node',
		'    relabel_configs:',
		'      - action: labelmap',
		'        regex: __meta_kubernetes_node_label_(.+)',
		'      - target_label: __address__',
		'        replacement: kubernetes.default.svc:443',
		'      - source_labels: [__meta_kubernetes_node_name]',
		'        regex: (.+)',
		'        target_label: __metrics_path__',
		'        replacement: /api/v1/nodes/${1}/proxy/metrics',
		''
	].join('\n');
}

export function buildPrometheusConfigMap(namespace: string): V1ConfigMap {
	return {
		apiVersion: 'v1',
		kind: 'ConfigMap',
		metadata: { name: CONFIG_NAME, namespace, labels: labels() },
		data: { 'prometheus.yml': buildPrometheusConfig() }
	};
}

export function buildPrometheusPVC(namespace: string, storageClass: string): V1PersistentVolumeClaim {
	return {
		apiVersion: 'v1',
		kind: 'PersistentVolumeClaim',
		metadata: { name: PVC_NAME, namespace, labels: labels() },
		spec: {
			accessModes: ['ReadWriteOnce'],
			...(storageClass ? { storageClassName: storageClass } : {}),
			resources: { requests: { storage: env.prometheusStorageSize } }
		}
	};
}

export function buildPrometheusService(namespace: string): V1Service {
	return {
		apiVersion: 'v1',
		kind: 'Service',
		metadata: { name: PROMETHEUS_NAME, namespace, labels: labels() },
		spec: {
			selector: labels(),
			ports: [{ name: 'http', port: PROMETHEUS_PORT, targetPort: PROMETHEUS_PORT }]
		}
	};
}

export function buildPrometheusDeployment(namespace: string, image: string = env.prometheusImage): V1Deployment {
	return {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: { name: PROMETHEUS_NAME, namespace, labels: labels() },
		spec: {
			replicas: 1,
			// Single writer to one RWO volume - never run two against the same TSDB.
			strategy: { type: 'Recreate' },
			selector: { matchLabels: labels() },
			template: {
				metadata: { labels: labels(), annotations: { [SPEC_HASH_ANNOTATION]: specHash(image) } },
				spec: {
					serviceAccountName: SERVICE_ACCOUNT,
					securityContext: { fsGroup: 65534, runAsNonRoot: true, runAsUser: 65534 },
					containers: [
						{
							name: 'prometheus',
							image,
							args: deploymentArgs(),
							ports: [{ containerPort: PROMETHEUS_PORT }],
							resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { cpu: '500m', memory: '1Gi' } },
							volumeMounts: [
								{ name: 'config', mountPath: '/etc/prometheus' },
								{ name: 'data', mountPath: '/prometheus' }
							]
						}
					],
					volumes: [
						{ name: 'config', configMap: { name: CONFIG_NAME } },
						{ name: 'data', persistentVolumeClaim: { claimName: PVC_NAME } }
					]
				}
			}
		}
	};
}

// Converge (managed mode) or tear down platform Prometheus to match the configured provider; idempotent, safe every tick.
export async function reconcilePlatformPrometheus(kc: KubeConfig): Promise<void> {
	const provider = await readMetricsProvider();
	const namespace = env.podNamespace;
	const appsApi = kc.makeApiClient(AppsV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);

	if (!prometheusEnabled(provider)) {
		// Only tear down if managed Prometheus was actually provisioned, to avoid four delete calls every tick on the common 'live' install.
		const provisioned =
			(await readDeploymentOrNull(appsApi, namespace, PROMETHEUS_NAME)) ?? (await readConfigMapOrNull(coreApi, namespace, CONFIG_NAME));

		if (provisioned) await teardownPrometheus(appsApi, coreApi, namespace);

		return;
	}

	// Create or replace so scrape-config changes apply.
	const existingConfig = await readConfigMapOrNull(coreApi, namespace, CONFIG_NAME);
	if (!existingConfig) {
		await coreApi.createNamespacedConfigMap({ namespace, body: buildPrometheusConfigMap(namespace) });
	} else {
		await replaceWithRetry({
			label: `ConfigMap ${CONFIG_NAME}`,
			read: () => readConfigMapOrNull(coreApi, namespace, CONFIG_NAME),
			build: () => buildPrometheusConfigMap(namespace),
			carryOver: (fresh, desired) => ({
				...desired,
				metadata: { ...desired.metadata, resourceVersion: fresh.metadata?.resourceVersion ?? undefined }
			}),
			replace: body => coreApi.replaceNamespacedConfigMap({ name: CONFIG_NAME, namespace, body })
		});
	}

	// Create if missing; both PVC and Service are effectively immutable, no churn on existing.
	if (!(await readPVCOrNull(coreApi, namespace, PVC_NAME))) {
		await coreApi.createNamespacedPersistentVolumeClaim({ namespace, body: buildPrometheusPVC(namespace, env.storageClassName) });
	}

	if (!(await readServiceOrNull(coreApi, namespace, PROMETHEUS_NAME))) {
		await coreApi.createNamespacedService({ namespace, body: buildPrometheusService(namespace) });
	}

	// Create if missing, else replace only when the spec hash changed — replacing rolls the pod to load the new prometheus.yml; unchanged skips to avoid churn.
	const existingDeployment = await readDeploymentOrNull(appsApi, namespace, PROMETHEUS_NAME);
	if (!existingDeployment) {
		await appsApi.createNamespacedDeployment({ namespace, body: buildPrometheusDeployment(namespace) });
	} else {
		const currentHash = existingDeployment.spec?.template?.metadata?.annotations?.[SPEC_HASH_ANNOTATION];
		const desiredHash = specHash(env.prometheusImage);

		if (currentHash !== desiredHash) {
			await replaceWithRetry({
				label: `Deployment ${PROMETHEUS_NAME}`,
				read: () => readDeploymentOrNull(appsApi, namespace, PROMETHEUS_NAME),
				build: () => buildPrometheusDeployment(namespace),
				carryOver: (fresh, desired) => ({
					...desired,
					metadata: { ...desired.metadata, resourceVersion: fresh.metadata?.resourceVersion ?? undefined }
				}),
				replace: body => appsApi.replaceNamespacedDeployment({ name: PROMETHEUS_NAME, namespace, body })
			});
		}
	}
}

// Delete the managed Prometheus including its PVC - clean teardown, re-enabling starts a fresh TSDB.
async function teardownPrometheus(appsApi: AppsV1Api, coreApi: CoreV1Api, namespace: string): Promise<void> {
	await deleteIgnoreMissing(() => appsApi.deleteNamespacedDeployment({ name: PROMETHEUS_NAME, namespace }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedService({ name: PROMETHEUS_NAME, namespace }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedConfigMap({ name: CONFIG_NAME, namespace }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedPersistentVolumeClaim({ name: PVC_NAME, namespace }));
}
