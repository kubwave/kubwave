import { getKubeConfig } from '@kubwave/kube';
import { runSteps } from '../../../../shared/worker-common/steps.js';
import { reconcilePlatformPrometheus } from './prometheus.js';
import { reconcileHaMode } from './ha.js';
import { reconcileBuildRegistryApply } from './registry.js';

// Converge the platform-managed Prometheus and HA mode; an independent job on the same interval
// as the deployment reconcile (disjoint resources, runs concurrently).
export async function runPlatformReconcile(): Promise<void> {
	const kc = getKubeConfig();
	await runSteps('platform', [
		{ name: 'registry', run: () => reconcileBuildRegistryApply(kc) },
		{ name: 'prometheus', run: () => reconcilePlatformPrometheus(kc) },
		{ name: 'ha', run: () => reconcileHaMode(kc) }
	]);
}
