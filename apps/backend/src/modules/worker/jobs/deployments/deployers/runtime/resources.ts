import type { V1ResourceRequirements } from '@kubernetes/client-node';
import type { ResourceConfig, RuntimeConfig } from '@kubwave/db';

// Container resources from the four optional quantity strings; undefined when nothing is set so the spec matches readback (no spurious re-writes).
export function buildResources(resources: ResourceConfig | undefined): V1ResourceRequirements | undefined {
	if (!resources) return undefined;
	const requests: Record<string, string> = {};
	const limits: Record<string, string> = {};
	if (resources.cpuRequest) requests.cpu = resources.cpuRequest;
	if (resources.memoryRequest) requests.memory = resources.memoryRequest;
	if (resources.cpuLimit) limits.cpu = resources.cpuLimit;
	if (resources.memoryLimit) limits.memory = resources.memoryLimit;
	const out: V1ResourceRequirements = {};
	if (Object.keys(requests).length > 0) out.requests = requests;
	if (Object.keys(limits).length > 0) out.limits = limits;
	return out.requests || out.limits ? out : undefined;
}

// True when the live resources reflect config; compares only the four cpu/memory request+limit fields, treating missing as equal (no re-write per tick).
export function resourcesMatch(container: { resources?: V1ResourceRequirements }, config: RuntimeConfig): boolean {
	const desired = buildResources(config.resources);
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
