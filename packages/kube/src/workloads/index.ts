import type { V1Deployment } from '@kubernetes/client-node';

// Tenant workloads get a shorter rollout deadline (300s vs K8s default 600s) so broken rollouts surface promptly; the grace window covers late-ready pods.
export const SERVICE_ROLLOUT_PROGRESS_DEADLINE_SECONDS = 300;
export const SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS = 60;

// Labels identifying the K8s objects the worker creates; the worker is the only writer, everything else reads through these.
export const LABEL_MANAGED_BY = 'app.kubernetes.io/managed-by';
export const LABEL_NAME = 'app.kubernetes.io/name';
export const LABEL_SERVICE_ID = 'kubwave/service-id';
// Stamped on every per-environment namespace so GC can map namespaces back to environments.
export const LABEL_ENVIRONMENT_ID = 'kubwave/environment-id';

export const MANAGED_BY_VALUE = 'kubwave-worker';

export const WORKLOADS_NAMESPACE_PREFIX = 'kubwave-env-';

export function environmentNamespace(environmentId: string): string {
	return `${WORKLOADS_NAMESPACE_PREFIX}${environmentId}`;
}

export function resourceName(serviceId: string): string {
	return `svc-${serviceId}`;
}

export function pvcName(serviceId: string, volumeName: string): string {
	return `svc-${serviceId}-${volumeName}`;
}

export function secretName(serviceId: string): string {
	return `svc-${serviceId}-env`;
}

// Maps an absolute path to a valid Secret data key; NOT injective — distinct paths can collide, so callers must reject collisions (the config schema does).
export function fileKey(path: string): string {
	return path.replace(/^\/+/, '').replace(/[^-._a-zA-Z0-9]/g, '_');
}

export function internalServiceName(serviceId: string): string {
	return resourceName(serviceId);
}

export function selectorLabels(serviceId: string): Record<string, string> {
	return { [LABEL_SERVICE_ID]: serviceId };
}

// Live workload health from its Deployment; `unknown` ("couldn't read the cluster") is set only by the caller, never returned here.
export type ServiceRuntimeStatus = 'running' | 'degraded' | 'progressing' | 'stopped' | 'failed' | 'not_deployed' | 'unknown';

export interface ServiceRuntime {
	status: ServiceRuntimeStatus;
	readyReplicas: number;
	desiredReplicas: number;
	updatedReplicas: number;
	availableReplicas: number;
}

export function unknownRuntime(): ServiceRuntime {
	return { status: 'unknown', readyReplicas: 0, desiredReplicas: 0, updatedReplicas: 0, availableReplicas: 0 };
}

export type DeploymentRolloutState = 'ready' | 'progressing' | 'failed';

function progressDeadlineExceeded(dep: V1Deployment) {
	return dep.status?.conditions?.find(c => c.type === 'Progressing' && c.status === 'False' && c.reason === 'ProgressDeadlineExceeded') ?? null;
}

function timeMs(value: Date | string | null | undefined): number | null {
	if (!value) return null;
	const ms = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

function progressDeadlineFailureIsFinal(dep: V1Deployment, now: Date): boolean {
	const condition = progressDeadlineExceeded(dep);
	if (!condition) return false;
	const transitionedAt = timeMs(condition.lastTransitionTime);
	// No usable timestamp -> stay in the grace window, which protects pods that turn ready just after the deadline.
	if (transitionedAt == null) return false;
	return now.getTime() - transitionedAt >= SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS * 1000;
}

// Mirrors `kubectl rollout status`, except ProgressDeadlineExceeded is final only after a grace period so late-ready pods aren't frozen as failed.
export function deploymentRolloutState(dep: V1Deployment, now: Date = new Date()): DeploymentRolloutState {
	const desired = dep.spec?.replicas ?? 1;
	const status = dep.status;
	if ((status?.observedGeneration ?? 0) < (dep.metadata?.generation ?? 0)) return 'progressing';

	const updated = status?.updatedReplicas ?? 0;
	const ready = status?.readyReplicas ?? 0;
	const available = status?.availableReplicas ?? 0;
	const total = status?.replicas ?? 0;
	if (updated >= desired && ready >= desired && available >= desired && total <= desired) return 'ready';

	if (progressDeadlineFailureIsFinal(dep, now)) return 'failed';
	return 'progressing';
}

// Maps a Deployment to a display runtime status (null -> not_deployed); shares rollout gates with the worker so the UI agrees on terminal states.
export function deploymentRuntimeStatus(dep: V1Deployment | null, now: Date = new Date()): ServiceRuntime {
	if (!dep) {
		return { status: 'not_deployed', readyReplicas: 0, desiredReplicas: 0, updatedReplicas: 0, availableReplicas: 0 };
	}

	const desired = dep.spec?.replicas ?? 1;
	const status = dep.status;
	const counts = {
		readyReplicas: status?.readyReplicas ?? 0,
		desiredReplicas: desired,
		updatedReplicas: status?.updatedReplicas ?? 0,
		availableReplicas: status?.availableReplicas ?? 0
	};

	if (desired === 0) return { status: 'stopped', ...counts };

	const rollout = deploymentRolloutState(dep, now);
	if (rollout === 'failed') return { status: 'failed', ...counts };
	if (rollout === 'ready') return { status: 'running', ...counts };

	if ((status?.observedGeneration ?? 0) < (dep.metadata?.generation ?? 0) || counts.updatedReplicas < desired) {
		return { status: 'progressing', ...counts };
	}

	if (counts.readyReplicas >= desired && counts.availableReplicas >= desired) return { status: 'running', ...counts };
	if (counts.readyReplicas > 0) return { status: 'degraded', ...counts };
	return { status: 'progressing', ...counts };
}
