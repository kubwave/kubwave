import { parseCpuToMillicores, parseMemoryToBytes, type ClusterNodeUsage } from '@kubwave/kube';
import type { V1Container, V1Node, V1Pod } from '@kubernetes/client-node';
import type { ClusterNodeConditionsDto, ClusterNodeDto } from './cluster.dto.js';

const NODE_ROLE_LABEL_PREFIX = 'node-role.kubernetes.io/';

export interface PodRequests {
	cpuMillicores: number;
	memoryBytes: number;
	count: number;
}

function conditionIsTrue(node: V1Node, type: string): boolean {
	return node.status?.conditions?.some(condition => condition.type === type && condition.status === 'True') ?? false;
}

export function nodeConditions(node: V1Node): ClusterNodeConditionsDto {
	return {
		ready: conditionIsTrue(node, 'Ready'),
		memoryPressure: conditionIsTrue(node, 'MemoryPressure'),
		diskPressure: conditionIsTrue(node, 'DiskPressure'),
		pidPressure: conditionIsTrue(node, 'PIDPressure')
	};
}

export function nodeRoles(node: V1Node): string[] {
	return Object.keys(node.metadata?.labels ?? {})
		.filter(label => label.startsWith(NODE_ROLE_LABEL_PREFIX))
		.map(label => label.slice(NODE_ROLE_LABEL_PREFIX.length))
		.filter(role => role.length > 0)
		.sort();
}

// Completed build Jobs pile up; letting the apiserver drop terminated pods keeps pod lists small.
export const ACTIVE_POD_FIELD_SELECTOR = 'status.phase!=Succeeded,status.phase!=Failed';

// Terminated pods no longer hold a scheduler reservation, so they must not count toward requests or the pod tally.
export function isActive(pod: V1Pod): boolean {
	const phase = pod.status?.phase;
	return phase !== 'Succeeded' && phase !== 'Failed';
}

// The scheduler's effective request: init containers run one at a time before the app containers, native sidecars
// (restartPolicy Always) keep running alongside everything declared after them, and RuntimeClass overhead sits on top.
function effectiveRequest(pod: V1Pod, parse: (container: Pick<V1Container, 'resources'>) => number): number {
	let sidecars = 0;
	let initPeak = 0;
	for (const container of pod.spec?.initContainers ?? []) {
		if (container.restartPolicy === 'Always') sidecars += parse(container);
		else initPeak = Math.max(initPeak, parse(container) + sidecars);
	}

	const app = (pod.spec?.containers ?? []).reduce((sum, container) => sum + parse(container), 0);
	return Math.max(app + sidecars, initPeak) + parse({ resources: { requests: pod.spec?.overhead } });
}

export function sumRequests(pods: V1Pod[]): PodRequests {
	const totals: PodRequests = { cpuMillicores: 0, memoryBytes: 0, count: 0 };

	for (const pod of pods) {
		if (!isActive(pod)) continue;
		totals.count++;
		totals.cpuMillicores += effectiveRequest(pod, container => parseCpuToMillicores(container.resources?.requests?.cpu) ?? 0);
		totals.memoryBytes += effectiveRequest(pod, container => parseMemoryToBytes(container.resources?.requests?.memory) ?? 0);
	}

	return totals;
}

export function toNodeDto(node: V1Node, usage: ClusterNodeUsage | null | undefined, requests: PodRequests | undefined): ClusterNodeDto {
	const allocatable = node.status?.allocatable ?? {};
	const measured = usage?.available ? usage : null;

	return {
		name: node.metadata?.name ?? '',
		roles: nodeRoles(node),
		cordoned: node.spec?.unschedulable === true,
		kubeletVersion: node.status?.nodeInfo?.kubeletVersion ?? '',
		conditions: nodeConditions(node),
		cpu: { capacity: parseCpuToMillicores(allocatable.cpu) ?? 0, requested: requests?.cpuMillicores ?? 0, used: measured?.cpuMillicores ?? null },
		memory: { capacity: parseMemoryToBytes(allocatable.memory) ?? 0, requested: requests?.memoryBytes ?? 0, used: measured?.memoryBytes ?? null },
		disk: { capacity: usage?.fsCapacityBytes ?? 0, requested: null, used: usage ? usage.fsUsedBytes : null },
		pods: { capacity: Number(allocatable.pods ?? 0), requested: null, used: requests?.count ?? 0 }
	};
}
