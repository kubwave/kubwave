import { Injectable, Logger } from '@nestjs/common';
import { ApiException, CoreV1Api, type V1Node, type V1Pod } from '@kubernetes/client-node';
import { getKubeConfig, nodeStatsSummary, nodeUsageFromSummary, podStatsByKey, type NodeStatsSummary } from '@kubwave/kube';
import type { ClusterNodeConditionDetailDto, ClusterNodeDetailDto, ClusterNodePodDto } from './cluster.dto.js';
import { byLastSeen, toEventDto } from './event-mapper.js';
import { ACTIVE_POD_FIELD_SELECTOR, isActive, sumRequests, toNodeDto } from './node-mapper.js';

const CACHE_TTL_MS = 10_000;

// The apiserver reports a missing node as a 404 ApiException; anything else (connection refused, timeout, 5xx)
// means the cluster couldn't be reached at all, and the node may well still exist.
function unavailableReasonOf(error: unknown): 'not-found' | 'unreachable' {
	return error instanceof ApiException && error.code === 404 ? 'not-found' : 'unreachable';
}

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

// Mirrors kubectl's STATUS column: a stuck container's reason (CrashLoopBackOff, ImagePullBackOff) says more than the pod phase.
function podStatus(pod: V1Pod): string {
	if (pod.metadata?.deletionTimestamp) return 'Terminating';
	for (const container of [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])]) {
		const reason = container.state?.waiting?.reason ?? container.state?.terminated?.reason;
		if (reason && reason !== 'Completed') return reason;
	}
	return pod.status?.phase ?? 'Unknown';
}

function podDtos(pods: V1Pod[], summary: NodeStatsSummary | null): ClusterNodePodDto[] {
	const statsByKey = podStatsByKey(summary ? [summary] : []);

	return pods
		.filter(isActive)
		.map(pod => {
			const namespace = pod.metadata?.namespace ?? '';
			const name = pod.metadata?.name ?? '';
			const stats = statsByKey.get(`${namespace}/${name}`);

			return {
				namespace,
				name,
				status: podStatus(pod),
				restarts: (pod.status?.containerStatuses ?? []).reduce((sum, container) => sum + container.restartCount, 0),
				cpuMillicores: stats ? Math.round((stats.cpu?.usageNanoCores ?? 0) / 1e6) : null,
				memoryBytes: stats ? (stats.memory?.workingSetBytes ?? 0) : null
			};
		})
		.sort((a, b) => (b.cpuMillicores ?? -1) - (a.cpuMillicores ?? -1));
}

@Injectable()
export class ClusterNodeService {
	private readonly logger = new Logger(ClusterNodeService.name);
	// One entry: the detail page polls a single node, so older names only ever go stale.
	private cache: { name: string; at: number; value: ClusterNodeDetailDto } | null = null;

	async getNode(name: string): Promise<ClusterNodeDetailDto> {
		const cached = this.cache;
		if (cached?.name === name && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

		const value = await this.assemble(name);
		this.cache = { name, at: Date.now(), value };

		return value;
	}

	private async assemble(name: string): Promise<ClusterNodeDetailDto> {
		const sampledAt = new Date().toISOString();

		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);

			const [node, podList, eventList, summary] = await Promise.all([
				coreApi.readNode({ name }),
				coreApi.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${name},${ACTIVE_POD_FIELD_SELECTOR}` }),
				coreApi.listEventForAllNamespaces({ fieldSelector: `type=Warning,involvedObject.kind=Node,involvedObject.name=${name}` }),
				// One node's proxy failing must not blank the conditions, pods and events that came from the apiserver.
				nodeStatsSummary(coreApi, name).catch(() => null)
			]);
			const pods = podList.items;

			return {
				available: true,
				unavailableReason: null,
				sampledAt,
				node: toNodeDto(node, summary && nodeUsageFromSummary(summary), sumRequests(pods)),
				conditions: conditionDetails(node),
				taints: (node.spec?.taints ?? []).map(taintText),
				pods: podDtos(pods, summary),
				events: eventList.items.map(toEventDto).sort(byLastSeen)
			};
		} catch (error) {
			const unavailableReason = unavailableReasonOf(error);
			if (unavailableReason === 'unreachable') {
				this.logger.warn(`Node ${name} unavailable: ${error instanceof Error ? error.message : String(error)}`);
			}
			// An unknown node or an unreachable cluster leaves the page renderable instead of 500-ing.
			const empty = { capacity: 0, requested: null, used: null };
			return {
				available: false,
				unavailableReason,
				sampledAt,
				node: {
					name,
					roles: [],
					cordoned: false,
					kubeletVersion: '',
					conditions: { ready: false, memoryPressure: false, diskPressure: false, pidPressure: false },
					cpu: empty,
					memory: empty,
					disk: empty,
					pods: empty
				},
				conditions: [],
				taints: [],
				pods: [],
				events: []
			};
		}
	}
}
