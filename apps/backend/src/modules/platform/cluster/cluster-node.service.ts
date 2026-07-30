import { Injectable } from '@nestjs/common';
import { CoreV1Api, type CoreV1Event, type V1Node, type V1Pod } from '@kubernetes/client-node';
import { getKubeConfig, nodeStatsSummary, type NodeStatsSummary } from '@kubwave/kube';
import type { ClusterEventDto, ClusterNodeConditionDetailDto, ClusterNodeDetailDto, ClusterNodePodDto } from './cluster.dto.js';
import { sumRequests, toNodeDto, type NodeUsage } from './node-mapper.js';

const CACHE_TTL_MS = 10_000;

function taintText(taint: { key?: string; value?: string; effect?: string }): string {
	const pair = taint.value ? `${taint.key}=${taint.value}` : (taint.key ?? '');
	return `${pair}:${taint.effect ?? ''}`;
}

function conditionDetails(node: V1Node): ClusterNodeConditionDetailDto[] {
	return (node.status?.conditions ?? []).map(condition => ({
		type: condition.type ?? '',
		status: condition.status ?? '',
		reason: condition.reason ?? null,
		lastTransitionTime: condition.lastTransitionTime ? new Date(condition.lastTransitionTime).toISOString() : null
	}));
}

function nodeUsageOf(summary: NodeStatsSummary | null): NodeUsage | undefined {
	const stats = summary?.node;
	if (!stats) return undefined;

	return {
		cpuMillicores: Math.round((stats.cpu?.usageNanoCores ?? 0) / 1e6),
		memoryBytes: stats.memory?.workingSetBytes ?? 0,
		fsUsedBytes: stats.fs?.usedBytes ?? 0,
		fsCapacityBytes: stats.fs?.capacityBytes ?? 0
	};
}

function podDtos(pods: V1Pod[], summary: NodeStatsSummary | null): ClusterNodePodDto[] {
	const usage = new Map(
		(summary?.pods ?? []).map(stats => [
			`${stats.podRef?.namespace ?? ''}/${stats.podRef?.name ?? ''}`,
			{ cpuMillicores: Math.round((stats.cpu?.usageNanoCores ?? 0) / 1e6), memoryBytes: stats.memory?.workingSetBytes ?? 0 }
		])
	);

	return pods
		.map(pod => {
			const namespace = pod.metadata?.namespace ?? '';
			const name = pod.metadata?.name ?? '';
			const stats = usage.get(`${namespace}/${name}`);

			return {
				namespace,
				name,
				phase: pod.status?.phase ?? 'Unknown',
				cpuMillicores: stats?.cpuMillicores ?? null,
				memoryBytes: stats?.memoryBytes ?? null
			};
		})
		.sort((a, b) => (b.cpuMillicores ?? -1) - (a.cpuMillicores ?? -1));
}

function eventDto(event: CoreV1Event): ClusterEventDto {
	const value = event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp;
	const namespace = event.metadata?.namespace ?? null;

	return {
		id: event.metadata?.uid ?? `${namespace ?? ''}/${event.metadata?.name ?? ''}`,
		reason: event.reason ?? '',
		message: event.message ?? '',
		namespace,
		objectKind: event.involvedObject?.kind ?? null,
		objectName: event.involvedObject?.name ?? null,
		count: event.count ?? 1,
		lastSeen: value ? new Date(value as string | Date).toISOString() : null
	};
}

@Injectable()
export class ClusterNodeService {
	private cache = new Map<string, { at: number; value: ClusterNodeDetailDto }>();

	async getNode(name: string): Promise<ClusterNodeDetailDto> {
		const cached = this.cache.get(name);
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

		const value = await this.assemble(name);
		this.cache.set(name, { at: Date.now(), value });

		return value;
	}

	private async assemble(name: string): Promise<ClusterNodeDetailDto> {
		const sampledAt = new Date().toISOString();

		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);

			const [node, podList, eventList] = await Promise.all([
				coreApi.readNode({ name }),
				coreApi.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${name}` }),
				coreApi.listEventForAllNamespaces({ fieldSelector: `type=Warning,involvedObject.kind=Node,involvedObject.name=${name}` })
			]);

			// One node's proxy failing must not blank the conditions, pods and events that came from the apiserver.
			const summary = await nodeStatsSummary(coreApi, name).catch(() => null);
			const pods = podList.items;

			return {
				available: true,
				sampledAt,
				node: toNodeDto(node, nodeUsageOf(summary), sumRequests(pods)),
				conditions: conditionDetails(node),
				taints: (node.spec?.taints ?? []).map(taintText),
				pods: podDtos(pods, summary),
				events: eventList.items.map(eventDto).sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
			};
		} catch {
			// An unknown node or an unreachable cluster leaves the page renderable instead of 500-ing.
			return {
				available: false,
				sampledAt,
				node: {
					name,
					roles: [],
					cordoned: false,
					kubeletVersion: '',
					conditions: { ready: false, memoryPressure: false, diskPressure: false, pidPressure: false },
					cpu: { capacity: 0, requested: null, used: null },
					memory: { capacity: 0, requested: null, used: null },
					disk: { capacity: 0, requested: null, used: null },
					pods: { capacity: 0, requested: null, used: null }
				},
				conditions: [],
				taints: [],
				pods: [],
				events: []
			};
		}
	}
}
