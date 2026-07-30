import { parseCpuToMillicores, parseMemoryToBytes } from '@kubwave/kube';
import type { V1Node, V1Pod } from '@kubernetes/client-node';
import type { ClusterMeterDto, ClusterNodeConditionsDto, ClusterNodeDto } from './cluster.dto.js';

const NODE_ROLE_LABEL_PREFIX = 'node-role.kubernetes.io/';

export interface PodRequests {
	cpuMillicores: number;
	memoryBytes: number;
	count: number;
}

export interface NodeUsage {
	cpuMillicores: number;
	memoryBytes: number;
	fsUsedBytes: number;
	fsCapacityBytes: number;
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

// Terminated pods no longer hold a scheduler reservation, so they must not count toward requests or the pod tally.
export function isActive(pod: V1Pod): boolean {
	const phase = pod.status?.phase;
	return phase !== 'Succeeded' && phase !== 'Failed';
}

export function sumRequests(pods: V1Pod[]): PodRequests {
	const totals: PodRequests = { cpuMillicores: 0, memoryBytes: 0, count: 0 };

	for (const pod of pods) {
		if (!isActive(pod)) continue;
		totals.count++;
		for (const container of pod.spec?.containers ?? []) {
			totals.cpuMillicores += parseCpuToMillicores(container.resources?.requests?.cpu) ?? 0;
			totals.memoryBytes += parseMemoryToBytes(container.resources?.requests?.memory) ?? 0;
		}
	}

	return totals;
}

export function meter(capacity: number, requested: number | null, used: number | null): ClusterMeterDto {
	return { capacity, requested, used };
}

export function toNodeDto(node: V1Node, usage: NodeUsage | undefined, requests: PodRequests | undefined): ClusterNodeDto {
	const allocatable = node.status?.allocatable ?? {};

	return {
		name: node.metadata?.name ?? '',
		roles: nodeRoles(node),
		cordoned: node.spec?.unschedulable === true,
		kubeletVersion: node.status?.nodeInfo?.kubeletVersion ?? '',
		conditions: nodeConditions(node),
		cpu: meter(parseCpuToMillicores(allocatable.cpu) ?? 0, requests?.cpuMillicores ?? 0, usage?.cpuMillicores ?? null),
		memory: meter(parseMemoryToBytes(allocatable.memory) ?? 0, requests?.memoryBytes ?? 0, usage?.memoryBytes ?? null),
		disk: meter(usage?.fsCapacityBytes ?? 0, null, usage?.fsUsedBytes ?? null),
		pods: meter(Number(allocatable.pods ?? 0), null, requests?.count ?? 0)
	};
}
