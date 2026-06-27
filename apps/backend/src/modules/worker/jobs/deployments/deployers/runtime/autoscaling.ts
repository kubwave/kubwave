import type { AutoscalingV2Api, V2HorizontalPodAutoscaler, V2MetricSpec } from '@kubernetes/client-node';
import type { AutoscalingConfig, DeploymentLogEntry, RuntimeConfig } from '@kubwave/db';
import { resourceName } from '@kubwave/kube';
import { deleteIgnoreMissing, readHPAOrNull, replaceWithRetry } from '../../../../../../shared/cluster/ops.js';
import { commonLabels, stepEvent } from '../../../../../../shared/cluster/networking.js';
import { hasVolume } from './storage.js';

// True when an HPA owns replica count. RWO-volume services can NEVER be HPA-managed (Multi-Attach risk), enforced here so bad configs self-heal.
export function autoscalingEnabled(config: RuntimeConfig): boolean {
	return !hasVolume(config) && config.autoscaling?.enabled === true && config.autoscaling.maxReplicas != null;
}

// Resource-utilisation metric specs (cpu/memory) as a percentage of each resource request (the API/UI guarantee the request is set).
function buildHPAMetrics(autoscaling: AutoscalingConfig): V2MetricSpec[] {
	const metrics: V2MetricSpec[] = [];
	if (autoscaling.targetCpuUtilizationPercentage != null) {
		metrics.push({
			type: 'Resource',
			resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: autoscaling.targetCpuUtilizationPercentage } }
		});
	}
	if (autoscaling.targetMemoryUtilizationPercentage != null) {
		metrics.push({
			type: 'Resource',
			resource: { name: 'memory', target: { type: 'Utilization', averageUtilization: autoscaling.targetMemoryUtilizationPercentage } }
		});
	}
	return metrics;
}

// autoscaling/v2 HPA targeting this service's Deployment; only called when autoscalingEnabled is true (so maxReplicas is present).
export function buildHPA(serviceId: string, namespace: string, autoscaling: AutoscalingConfig): V2HorizontalPodAutoscaler {
	const name = resourceName(serviceId);
	return {
		apiVersion: 'autoscaling/v2',
		kind: 'HorizontalPodAutoscaler',
		metadata: { name, namespace, labels: commonLabels(serviceId) },
		spec: {
			scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name },
			minReplicas: autoscaling.minReplicas ?? 1,
			maxReplicas: autoscaling.maxReplicas!,
			metrics: buildHPAMetrics(autoscaling)
		}
	};
}

// True when the live HPA reflects the desired spec; compares only owned fields (min/max + cpu/memory targets) to avoid a spurious diff on server defaults.
export function hpaMatches(existing: V2HorizontalPodAutoscaler, desired: V2HorizontalPodAutoscaler): boolean {
	if ((existing.spec?.minReplicas ?? 1) !== (desired.spec?.minReplicas ?? 1)) return false;
	if ((existing.spec?.maxReplicas ?? 0) !== (desired.spec?.maxReplicas ?? 0)) return false;
	const util = (hpa: V2HorizontalPodAutoscaler, resource: 'cpu' | 'memory'): number =>
		(hpa.spec?.metrics ?? []).find(m => m.type === 'Resource' && m.resource?.name === resource)?.resource?.target?.averageUtilization ?? 0;
	return util(existing, 'cpu') === util(desired, 'cpu') && util(existing, 'memory') === util(desired, 'memory');
}

// Converge the HPA: create when enabled, replace on an owned-field change, delete when disabled. Idempotent; only emits a step event when it writes.
export async function convergeHPA(
	api: AutoscalingV2Api,
	namespace: string,
	serviceId: string,
	config: RuntimeConfig,
	events: DeploymentLogEntry[]
): Promise<void> {
	const name = resourceName(serviceId);
	const existing = await readHPAOrNull(api, namespace, name);

	if (!autoscalingEnabled(config)) {
		if (existing) {
			await deleteIgnoreMissing(() => api.deleteNamespacedHorizontalPodAutoscaler({ name, namespace }));
			events.push(stepEvent('hpa-converged', `Removed HPA ${name} in ${namespace} (autoscaling disabled)`));
		}
		return;
	}

	const autoscaling = config.autoscaling!;
	const scaleSummary = `min=${autoscaling.minReplicas ?? 1}, max=${autoscaling.maxReplicas}`;
	const desired = buildHPA(serviceId, namespace, autoscaling);
	if (!existing) {
		await api.createNamespacedHorizontalPodAutoscaler({ namespace, body: desired });
		events.push(stepEvent('hpa-converged', `Created HPA ${name} in ${namespace} (${scaleSummary})`));
		return;
	}
	if (!hpaMatches(existing, desired)) {
		await replaceWithRetry({
			label: `HPA ${name}`,
			read: () => readHPAOrNull(api, namespace, name),
			build: () => buildHPA(serviceId, namespace, autoscaling),
			carryOver: (fresh, body) => {
				body.metadata = { ...body.metadata, resourceVersion: fresh.metadata?.resourceVersion ?? undefined };
				return body;
			},
			replace: body => api.replaceNamespacedHorizontalPodAutoscaler({ name, namespace, body })
		});
		events.push(stepEvent('hpa-converged', `Updated HPA ${name} in ${namespace} (${scaleSummary})`));
	}
}
