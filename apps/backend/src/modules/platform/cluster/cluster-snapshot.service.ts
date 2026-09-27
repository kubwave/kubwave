import { Injectable, Logger } from '@nestjs/common';
import { AppsV1Api, CoreV1Api, type V1Deployment, type V1Node, type V1Pod } from '@kubernetes/client-node';
import {
	aggregateClusterUsage,
	CNPG_CLUSTER_NAME,
	getKubeConfig,
	nodeStatsSummary,
	PROMETHEUS_NAME,
	type ClusterUsageAggregate
} from '@kubwave/kube';
import { BackendConfigService } from '../../../shared/config/backend-config.service.js';
import type { ClusterComponentDto, ClusterNodeDto, ClusterSnapshotDto } from './cluster.dto.js';
import { ACTIVE_POD_FIELD_SELECTOR, sumRequests, toNodeDto, type PodRequests } from './node-mapper.js';

const CACHE_TTL_MS = 10_000;

// Chart resources all carry part-of=kubwave; the worker-managed Prometheus only exists while it is the configured provider.
function isComponent(deployment: V1Deployment): boolean {
	const labels = deployment.metadata?.labels ?? {};
	return labels['app.kubernetes.io/part-of'] === 'kubwave' || labels['app.kubernetes.io/name'] === PROMETHEUS_NAME;
}

// Postgres ships as a CNPG Cluster or a StatefulSet (and can be external); its pods are the one signal that covers all three.
function isPostgresPod(pod: V1Pod): boolean {
	const labels = pod.metadata?.labels ?? {};
	return labels['cnpg.io/cluster'] === CNPG_CLUSTER_NAME || labels['app.kubernetes.io/name'] === 'postgres';
}

function isReady(pod: V1Pod): boolean {
	return pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True') ?? false;
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

@Injectable()
export class ClusterSnapshotService {
	private readonly logger = new Logger(ClusterSnapshotService.name);
	private cache: { at: number; value: ClusterSnapshotDto } | null = null;

	constructor(private readonly config: BackendConfigService) {}

	async getSnapshot(): Promise<ClusterSnapshotDto> {
		const cached = this.cache;
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

		const value = await this.assemble();
		this.cache = { at: Date.now(), value };

		return value;
	}

	private async assemble(): Promise<ClusterSnapshotDto> {
		const sampledAt = new Date().toISOString();

		try {
			const kc = getKubeConfig();
			const coreApi = kc.makeApiClient(CoreV1Api);
			const appsApi = kc.makeApiClient(AppsV1Api);
			const namespace = this.config.api.podNamespace;

			const [nodeList, podList, deploymentList] = await Promise.all([
				coreApi.listNode(),
				coreApi.listPodForAllNamespaces({ fieldSelector: ACTIVE_POD_FIELD_SELECTOR }),
				appsApi.listNamespacedDeployment({ namespace })
			]);
			const nodes = nodeList.items;
			const pods = podList.items;

			const usage = await this.readUsage(coreApi, nodes, namespace);
			const usageByNode = new Map(usage.nodes.map(node => [node.nodeName, node]));
			const measured = usage.nodes.filter(node => node.available);

			const podsByNode = new Map<string, V1Pod[]>();
			for (const pod of pods) {
				const nodeName = pod.spec?.nodeName;
				if (!nodeName) continue;
				const nodePods = podsByNode.get(nodeName);
				if (nodePods) nodePods.push(pod);
				else podsByNode.set(nodeName, [pod]);
			}
			const requestsByNode = new Map<string, PodRequests>([...podsByNode].map(([name, nodePods]) => [name, sumRequests(nodePods)]));

			const nodeDtos = nodes.map(node => {
				const name = node.metadata?.name ?? '';
				return toNodeDto(node, usageByNode.get(name), requestsByNode.get(name));
			});
			const components = this.readComponents(deploymentList.items, pods, namespace);
			const storageKnown = usage.nodes.length > 0 && usage.volumeCapacityBytes > 0;

			return {
				available: true,
				sampledAt,
				state: this.deriveState(nodeDtos, components),
				nodesReady: nodeDtos.filter(node => node.conditions.ready).length,
				nodesTotal: nodeDtos.length,
				// Totals come from the per-node values, so pending pods without a node never count as a reservation.
				cpu: {
					capacity: sum(nodeDtos.map(node => node.cpu.capacity)),
					requested: sum(nodeDtos.map(node => node.cpu.requested ?? 0)),
					used: measured.length > 0 ? sum(measured.map(node => node.cpuMillicores)) : null
				},
				memory: {
					capacity: sum(nodeDtos.map(node => node.memory.capacity)),
					requested: sum(nodeDtos.map(node => node.memory.requested ?? 0)),
					used: measured.length > 0 ? sum(measured.map(node => node.memoryBytes)) : null
				},
				storage: { capacity: usage.volumeCapacityBytes, requested: null, used: storageKnown ? usage.volumeUsedBytes : null },
				pods: { capacity: sum(nodeDtos.map(node => node.pods.capacity)), requested: null, used: sum(nodeDtos.map(node => node.pods.used ?? 0)) },
				nodes: nodeDtos,
				components,
				split: { platform: usage.platform, tenants: usage.tenants, other: usage.other }
			};
		} catch (error) {
			// Keep the admin page useful when the cluster is unreachable instead of failing the request.
			this.logger.warn(`Cluster snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
			const empty = { capacity: 0, requested: null, used: null };
			return {
				available: false,
				sampledAt,
				state: 'unknown',
				nodesReady: 0,
				nodesTotal: 0,
				cpu: empty,
				memory: empty,
				storage: empty,
				pods: empty,
				nodes: [],
				components: [],
				split: {
					platform: { cpuMillicores: 0, memoryBytes: 0 },
					tenants: { cpuMillicores: 0, memoryBytes: 0 },
					other: { cpuMillicores: 0, memoryBytes: 0 }
				}
			};
		}
	}

	private async readUsage(coreApi: CoreV1Api, nodes: V1Node[], platformNamespace: string): Promise<ClusterUsageAggregate> {
		const names = nodes.map(node => node.metadata?.name).filter((name): name is string => Boolean(name));
		// A failed or slow node only drops out of the totals; the others still contribute usage.
		const results = await Promise.allSettled(names.map(name => nodeStatsSummary(coreApi, name)));
		const summaries = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));

		return aggregateClusterUsage({ summaries, platformNamespace });
	}

	private readComponents(deployments: V1Deployment[], pods: V1Pod[], namespace: string): ClusterComponentDto[] {
		const components: ClusterComponentDto[] = deployments.filter(isComponent).map(deployment => ({
			name: deployment.metadata?.name ?? '',
			ready: deployment.status?.readyReplicas ?? 0,
			desired: deployment.spec?.replicas ?? 0
		}));

		const postgresPods = pods.filter(pod => pod.metadata?.namespace === namespace && isPostgresPod(pod));
		if (postgresPods.length > 0) {
			components.push({ name: 'postgres', ready: postgresPods.filter(isReady).length, desired: postgresPods.length });
		}

		return components.sort((a, b) => a.name.localeCompare(b.name));
	}

	// Cordoning is deliberate, so it never degrades the cluster on its own.
	private deriveState(nodes: ClusterNodeDto[], components: ClusterComponentDto[]): 'ok' | 'degraded' {
		const nodeUnhealthy = nodes.some(
			node => !node.conditions.ready || node.conditions.memoryPressure || node.conditions.diskPressure || node.conditions.pidPressure
		);
		const componentUnhealthy = components.some(component => component.ready < component.desired);

		return nodeUnhealthy || componentUnhealthy ? 'degraded' : 'ok';
	}
}
