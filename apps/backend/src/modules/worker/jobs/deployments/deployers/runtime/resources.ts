import type { V1ResourceRequirements } from '@kubernetes/client-node';
import type { ResourceConfig, RuntimeConfig } from '@kubwave/db';

// Container resources from the four optional quantity strings; each unset field falls back to the cluster-wide default so every tenant pod reserves a scheduling baseline (spreads pods + gives the cluster-autoscaler a signal). Returns undefined when nothing resolves.
export function buildResources(resources: ResourceConfig | undefined, defaults?: ResourceConfig): V1ResourceRequirements | undefined {
	const requests: Record<string, string> = {};
	const limits: Record<string, string> = {};
	const cpuRequest = resources?.cpuRequest ?? defaults?.cpuRequest;
	const memoryRequest = resources?.memoryRequest ?? defaults?.memoryRequest;
	const cpuLimit = resources?.cpuLimit ?? defaults?.cpuLimit;
	const memoryLimit = resources?.memoryLimit ?? defaults?.memoryLimit;
	if (cpuRequest) requests.cpu = cpuRequest;
	if (memoryRequest) requests.memory = memoryRequest;
	if (cpuLimit) limits.cpu = cpuLimit;
	if (memoryLimit) limits.memory = memoryLimit;
	const out: V1ResourceRequirements = {};
	if (Object.keys(requests).length > 0) out.requests = requests;
	if (Object.keys(limits).length > 0) out.limits = limits;
	return out.requests || out.limits ? out : undefined;
}

// True when the live resources reflect config; compares only the four cpu/memory request+limit fields (each with the same default fallback as buildResources) so the reconciler neither flaps nor misses a default rollout.
export function resourcesMatch(container: { resources?: V1ResourceRequirements }, config: RuntimeConfig, defaults?: ResourceConfig): boolean {
	const desired = buildResources(config.resources, defaults);
	const existing = container.resources;
	const get = (r: V1ResourceRequirements | undefined, kind: 'requests' | 'limits', key: 'cpu' | 'memory'): string =>
		(r?.[kind] as Record<string, string> | undefined)?.[key] ?? '';
	return (
		get(existing, 'requests', 'cpu') === get(desired, 'requests', 'cpu') &&
		get(existing, 'requests', 'memory') === get(desired, 'requests', 'memory') &&
		get(existing, 'limits', 'cpu') === get(desired, 'limits', 'cpu') &&
		get(existing, 'limits', 'memory') === get(desired, 'limits', 'memory')
	);
}
