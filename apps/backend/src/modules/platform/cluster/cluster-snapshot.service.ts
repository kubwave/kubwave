import { Injectable } from '@nestjs/common';
import { AppsV1Api, CoreV1Api, type V1Node, type V1Pod } from '@kubernetes/client-node';
import {
	aggregateClusterUsage,
	CNPG_POD_SELECTOR,
	getKubeConfig,
	nodeStatsSummary,
	parseCpuToMillicores,
	parseMemoryToBytes,
	PROMETHEUS_NAME,
	type ClusterUsageAggregate,
	type NodeStatsSummary
} from '@kubwave/kube';
import { BackendConfigService } from '../../../shared/config/backend-config.service.js';
import { MetricsConfigService } from '../../../shared/metrics/metrics-config.service.js';
import type { ClusterComponentDto, ClusterMeterDto, ClusterNodeConditionsDto, ClusterNodeDto, ClusterSnapshotDto } from './cluster.dto.js';

// Chart resources all carry part-of=kubwave, so one selector covers api/worker/console/registry without hardcoding names.
const PLATFORM_COMPONENT_SELECTOR = 'app.kubernetes.io/part-of=kubwave';
const NODE_ROLE_LABEL_PREFIX = 'node-role.kubernetes.io/';
const CACHE_TTL_MS = 10_000;

interface PodRequests {
	cpuMillicores: number;
	memoryBytes: number;
	count: number;
}

function conditionIsTrue(node: V1Node, type: string): boolean {
	return node.status?.conditions?.some(condition => condition.type === type && condition.status === 'True') ?? false;
}

function nodeConditions(node: V1Node): ClusterNodeConditionsDto {
	return {
		ready: conditionIsTrue(node, 'Ready'),
		memoryPressure: conditionIsTrue(node, 'MemoryPressure'),
		diskPressure: conditionIsTrue(node, 'DiskPressure'),
		pidPressure: conditionIsTrue(node, 'PIDPressure')
	};
}

function nodeRoles(node: V1Node): string[] {
	return Object.keys(node.metadata?.labels ?? {})
		.filter(label => label.startsWith(NODE_ROLE_LABEL_PREFIX))
		.map(label => label.slice(NODE_ROLE_LABEL_PREFIX.length))
		.filter(role => role.length > 0)
		.sort();
}

// Terminated pods no longer hold a scheduler reservation, so they must not count toward requests or the pod tally.
function isActive(pod: V1Pod): boolean {
	const phase = pod.status?.phase;
	return phase !== 'Succeeded' && phase !== 'Failed';
}

function sumRequests(pods: V1Pod[]): PodRequests {
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

function meter(capacity: number, requested: number | null, used: number | null): ClusterMeterDto {
	return { capacity, requested, used };
}

function podsReady(pods: V1Pod[]): number {
	return pods.filter(pod => pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')).length;
}

@Injectable()
export class ClusterSnapshotService {
	private cache: { at: number; value: ClusterSnapshotDto } | null = null;

	constructor(
		private readonly config: BackendConfigService,
		private readonly metricsConfig: MetricsConfigService
	) {}

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

			const [nodeList, podList] = await Promise.all([coreApi.listNode(), coreApi.listPodForAllNamespaces()]);
			const nodes = nodeList.items;
			const pods = podList.items;

			const usage = await this.readUsage(coreApi, nodes, namespace);
			const usageByNode = new Map(usage.nodes.filter(node => node.available).map(node => [node.nodeName, node]));
			const requestsByNode = new Map<string, PodRequests>();
			for (const node of nodes) {
				const name = node.metadata?.name;
				if (name) requestsByNode.set(name, sumRequests(pods.filter(pod => pod.spec?.nodeName === name)));
			}

			const nodeDtos = nodes.map(node => this.toNodeDto(node, usageByNode, requestsByNode));
			const clusterRequests = sumRequests(pods);
			const anyUsage = usageByNode.size > 0;

			const cpuCapacity = nodeDtos.reduce((sum, node) => sum + node.cpu.capacity, 0);
			const memoryCapacity = nodeDtos.reduce((sum, node) => sum + node.memory.capacity, 0);
			const podCapacity = nodeDtos.reduce((sum, node) => sum + node.pods.capacity, 0);
			const cpuUsed = anyUsage ? [...usageByNode.values()].reduce((sum, node) => sum + node.cpuMillicores, 0) : null;
			const memoryUsed = anyUsage ? [...usageByNode.values()].reduce((sum, node) => sum + node.memoryBytes, 0) : null;

			const components = await this.readComponents(coreApi, appsApi, namespace);
			const nodesReady = nodeDtos.filter(node => node.conditions.ready).length;

			return {
				available: true,
				sampledAt,
				state: this.deriveState(nodeDtos, components),
				nodesReady,
				nodesTotal: nodeDtos.length,
				cpu: meter(cpuCapacity, clusterRequests.cpuMillicores, cpuUsed),
				memory: meter(memoryCapacity, clusterRequests.memoryBytes, memoryUsed),
				storage: meter(usage.volumeCapacityBytes, null, anyUsage ? usage.volumeUsedBytes : null),
				pods: meter(podCapacity, null, clusterRequests.count),
				nodes: nodeDtos,
				components,
				split: { platform: usage.platform, tenants: usage.tenants, other: usage.other }
			};
		} catch {
			// Keep the admin page useful when the cluster is unreachable instead of failing the request.
			return {
				available: false,
				sampledAt,
				state: 'unknown',
				nodesReady: 0,
				nodesTotal: 0,
				cpu: meter(0, null, null),
				memory: meter(0, null, null),
				storage: meter(0, null, null),
				pods: meter(0, null, null),
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
		const summaries: NodeStatsSummary[] = [];

		for (const node of nodes) {
			const name = node.metadata?.name;
			if (!name) continue;
			try {
				summaries.push(await nodeStatsSummary(coreApi, name));
			} catch {
				// Skip only this node; the others still contribute usage.
			}
		}

		return aggregateClusterUsage({ summaries, platformNamespace });
	}

	private toNodeDto(
		node: V1Node,
		usageByNode: Map<string, { cpuMillicores: number; memoryBytes: number; fsUsedBytes: number; fsCapacityBytes: number }>,
		requestsByNode: Map<string, PodRequests>
	): ClusterNodeDto {
		const name = node.metadata?.name ?? '';
		const usage = usageByNode.get(name);
		const requests = requestsByNode.get(name);
		const allocatable = node.status?.allocatable ?? {};

		return {
			name,
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

	private async readComponents(coreApi: CoreV1Api, appsApi: AppsV1Api, namespace: string): Promise<ClusterComponentDto[]> {
		const components: ClusterComponentDto[] = [];

		const deployments = await appsApi.listNamespacedDeployment({ namespace, labelSelector: PLATFORM_COMPONENT_SELECTOR });
		for (const deployment of deployments.items) {
			components.push({
				name: deployment.metadata?.name ?? '',
				ready: deployment.status?.readyReplicas ?? 0,
				desired: deployment.spec?.replicas ?? 0
			});
		}

		// Postgres ships as either a CNPG Cluster or a StatefulSet, and can be external; its pods are the one signal that covers all three.
		const postgresPods = await coreApi.listNamespacedPod({ namespace, labelSelector: CNPG_POD_SELECTOR });
		if (postgresPods.items.length > 0) {
			components.push({ name: 'postgres', ready: podsReady(postgresPods.items), desired: postgresPods.items.length });
		}

		const metrics = await this.metricsConfig.getMetricsProviderSettings();
		if (metrics.provider === 'prometheus-managed') {
			const prometheus = await appsApi.listNamespacedDeployment({ namespace, labelSelector: `app.kubernetes.io/name=${PROMETHEUS_NAME}` });
			for (const deployment of prometheus.items) {
				components.push({
					name: PROMETHEUS_NAME,
					ready: deployment.status?.readyReplicas ?? 0,
					desired: deployment.spec?.replicas ?? 0
				});
			}
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
