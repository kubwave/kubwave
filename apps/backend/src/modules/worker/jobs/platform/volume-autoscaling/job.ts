import { CoreV1Api, CustomObjectsApi, StorageV1Api, type KubeConfig } from '@kubernetes/client-node';
import { getKubeConfig, type NodeStatsSummary } from '@kubwave/kube';
import { env } from '../../../../../shared/config/worker-env.js';
import { runSteps } from '../../../../../shared/worker-common/steps.js';
import { readAutoscalingSettings } from './common.js';
import { reconcileRegistryVolume } from './registry.js';
import { reconcilePostgresVolume } from './postgres.js';
import { reconcilePrometheusVolume } from './prometheus.js';
import { prometheusEnabled, readMetricsProvider } from '../prometheus.js';

// Sweep entry point: runs registry + postgres reconcilers as isolated steps so a per-volume failure can't block the other.
export async function runVolumeAutoscaling(kc: KubeConfig = getKubeConfig()): Promise<void> {
	const config = await readAutoscalingSettings();
	if (!config.enabled) return;

	const namespace = env.podNamespace;
	const coreApi = kc.makeApiClient(CoreV1Api);
	const customApi = kc.makeApiClient(CustomObjectsApi);
	const storageApi = kc.makeApiClient(StorageV1Api);
	const summaryCache = new Map<string, NodeStatsSummary | null>();
	const provider = await readMetricsProvider();

	await runSteps('volume-autoscaling', [
		{ name: 'registry', run: () => reconcileRegistryVolume(coreApi, storageApi, namespace, config, summaryCache) },
		{ name: 'postgres', run: () => reconcilePostgresVolume(coreApi, customApi, storageApi, namespace, config, summaryCache) },
		...(prometheusEnabled(provider)
			? [{ name: 'prometheus', run: () => reconcilePrometheusVolume(coreApi, storageApi, namespace, config, summaryCache) }]
			: [])
	]);
}
