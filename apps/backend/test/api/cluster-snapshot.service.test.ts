import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BackendConfigService } from '~/shared/config/backend-config.service';
import type { MetricsConfigService } from '~/shared/metrics/metrics-config.service';

type NodeItem = {
	metadata?: { name?: string; labels?: Record<string, string> };
	spec?: { unschedulable?: boolean };
	status?: {
		allocatable?: Record<string, string>;
		conditions?: Array<{ type: string; status: string }>;
		nodeInfo?: { kubeletVersion?: string };
	};
};

let nodes: NodeItem[] = [];
let pods: unknown[] = [];
let deployments: unknown[] = [];
let cnpgPods: unknown[] = [];
let provider = 'live';
let listNodeThrows = false;
let summaryThrows = false;

function node(name: string, overrides: { unschedulable?: boolean; conditions?: Array<{ type: string; status: string }> } = {}): NodeItem {
	return {
		metadata: { name, labels: { 'node-role.kubernetes.io/control-plane': '' } },
		spec: { unschedulable: overrides.unschedulable ?? false },
		status: {
			allocatable: { cpu: '4', memory: '8Gi', pods: '110' },
			conditions: overrides.conditions ?? [{ type: 'Ready', status: 'True' }],
			nodeInfo: { kubeletVersion: 'v1.31.2' }
		}
	};
}

function pod(namespace: string, name: string, cpu: string, memory: string, phase = 'Running') {
	return {
		metadata: { namespace, name },
		spec: { nodeName: 'node-1', containers: [{ resources: { requests: { cpu, memory } } }] },
		status: { phase }
	};
}

mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

mock.module('@kubwave/kube', () => ({
	WORKLOADS_NAMESPACE_PREFIX: 'kubwave-env-',
	CNPG_POD_SELECTOR: 'cnpg.io/cluster=postgres',
	PROMETHEUS_NAME: 'kubwave-prometheus',
	PROMETHEUS_POD_SELECTOR: 'app.kubernetes.io/name=kubwave-prometheus',
	DEFAULT_METRICS_PROVIDER: 'live',
	METRICS_SETTINGS_KEY: 'metrics-provider',
	parseCpuToMillicores: (q?: string | null) => (q == null ? null : q.endsWith('m') ? Number(q.slice(0, -1)) : Math.round(Number(q) * 1000)),
	parseMemoryToBytes: (q?: string | null) => {
		if (q == null) return null;
		if (q.endsWith('Gi')) return Number(q.slice(0, -2)) * 1024 ** 3;
		if (q.endsWith('Mi')) return Number(q.slice(0, -2)) * 1024 ** 2;
		return Number(q);
	},
	aggregateClusterUsage: ({ summaries }: { summaries: unknown[] }) =>
		summaries.length === 0
			? {
					nodes: [],
					volumeUsedBytes: 0,
					volumeCapacityBytes: 0,
					platform: { cpuMillicores: 0, memoryBytes: 0 },
					tenants: { cpuMillicores: 0, memoryBytes: 0 },
					other: { cpuMillicores: 0, memoryBytes: 0 }
				}
			: {
					nodes: [{ nodeName: 'node-1', available: true, cpuMillicores: 1000, memoryBytes: 1024 ** 3, fsUsedBytes: 100, fsCapacityBytes: 1000 }],
					volumeUsedBytes: 50,
					volumeCapacityBytes: 500,
					platform: { cpuMillicores: 100, memoryBytes: 512 },
					tenants: { cpuMillicores: 200, memoryBytes: 1024 },
					other: { cpuMillicores: 50, memoryBytes: 256 }
				},
	nodeStatsSummary: async () => {
		if (summaryThrows) throw new Error('node proxy unavailable');
		return { node: { nodeName: 'node-1' }, pods: [] };
	},
	getKubeConfig: () => ({
		makeApiClient: () => ({
			listNode: async () => {
				if (listNodeThrows) throw new Error('unreachable');
				return { items: nodes };
			},
			listPodForAllNamespaces: async () => ({ items: pods }),
			listNamespacedPod: async () => ({ items: cnpgPods }),
			listNamespacedDeployment: async () => ({ items: deployments })
		})
	})
}));

const { ClusterSnapshotService } = await import('~/modules/platform/cluster/cluster-snapshot.service');

function makeService() {
	const config = { api: { podNamespace: 'kubwave' } } as unknown as BackendConfigService;
	const metricsConfig = {
		getMetricsProviderSettings: async () => ({ provider, prometheusUrl: null })
	} as unknown as MetricsConfigService;
	return new ClusterSnapshotService(config, metricsConfig);
}

beforeEach(() => {
	nodes = [node('node-1')];
	pods = [
		pod('kubwave', 'api-1', '500m', '1Gi'),
		pod('kubwave-env-abc', 'svc-1', '250m', '512Mi'),
		pod('kubwave-env-abc', 'finished', '4', '8Gi', 'Succeeded')
	];
	deployments = [{ metadata: { name: 'api' }, spec: { replicas: 1 }, status: { readyReplicas: 1 } }];
	cnpgPods = [];
	provider = 'live';
	listNodeThrows = false;
	summaryThrows = false;
});

describe('ClusterSnapshotService', () => {
	test('reports allocatable, requested and used per resource', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.available).toBe(true);
		expect(snapshot.cpu.capacity).toBe(4000);
		expect(snapshot.cpu.requested).toBe(750);
		expect(snapshot.cpu.used).toBe(1000);
		expect(snapshot.memory.capacity).toBe(8 * 1024 ** 3);
		expect(snapshot.memory.requested).toBe(1024 ** 3 + 512 * 1024 ** 2);
		expect(snapshot.memory.used).toBe(1024 ** 3);
	});

	test('excludes terminated pods from requested', async () => {
		pods = [pod('kubwave', 'api-1', '500m', '1Gi'), pod('kubwave', 'gone', '2', '4Gi', 'Failed')];
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.cpu.requested).toBe(500);
	});

	test('reports storage as deduped pvc usage with no request', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.storage).toEqual({ capacity: 500, requested: null, used: 50 });
	});

	test('counts non-terminated pods against allocatable pods', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.pods).toEqual({ capacity: 110, requested: null, used: 2 });
	});

	test('derives node roles from node-role labels', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.nodes[0]!.roles).toEqual(['control-plane']);
		expect(snapshot.nodes[0]!.kubeletVersion).toBe('v1.31.2');
	});

	test('is ok when every node is ready and every component is ready', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.state).toBe('ok');
		expect(snapshot.nodesReady).toBe(1);
		expect(snapshot.nodesTotal).toBe(1);
	});

	test('is degraded when a node reports disk pressure', async () => {
		nodes = [
			node('node-1', {
				conditions: [
					{ type: 'Ready', status: 'True' },
					{ type: 'DiskPressure', status: 'True' }
				]
			})
		];
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.state).toBe('degraded');
		expect(snapshot.nodes[0]!.conditions.diskPressure).toBe(true);
	});

	test('is degraded when a node is not ready', async () => {
		nodes = [node('node-1', { conditions: [{ type: 'Ready', status: 'False' }] })];
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.state).toBe('degraded');
		expect(snapshot.nodesReady).toBe(0);
	});

	test('is degraded when a component has fewer ready than desired replicas', async () => {
		deployments = [{ metadata: { name: 'api' }, spec: { replicas: 2 }, status: { readyReplicas: 1 } }];
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.state).toBe('degraded');
		expect(snapshot.components).toContainEqual({ name: 'api', ready: 1, desired: 2 });
	});

	test('stays ok when a node is only cordoned', async () => {
		nodes = [node('node-1', { unschedulable: true })];
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.state).toBe('ok');
		expect(snapshot.nodes[0]!.cordoned).toBe(true);
	});

	test('includes a postgres component derived from cnpg pods', async () => {
		cnpgPods = [
			{ metadata: { name: 'postgres-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } },
			{ metadata: { name: 'postgres-2' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } }
		];
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.components).toContainEqual({ name: 'postgres', ready: 1, desired: 2 });
		expect(snapshot.state).toBe('degraded');
	});

	test('omits postgres entirely when no cnpg pods exist', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.components.some(c => c.name === 'postgres')).toBe(false);
	});

	test('exposes the workload split with three buckets', async () => {
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.split).toEqual({
			platform: { cpuMillicores: 100, memoryBytes: 512 },
			tenants: { cpuMillicores: 200, memoryBytes: 1024 },
			other: { cpuMillicores: 50, memoryBytes: 256 }
		});
	});

	test('keeps the snapshot usable when every node summary fails', async () => {
		summaryThrows = true;
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.available).toBe(true);
		expect(snapshot.cpu.used).toBeNull();
		expect(snapshot.nodes[0]!.cpu.used).toBeNull();
		expect(snapshot.storage.used).toBeNull();
	});

	test('returns an unavailable snapshot when the cluster is unreachable', async () => {
		listNodeThrows = true;
		const snapshot = await makeService().getSnapshot();
		expect(snapshot.available).toBe(false);
		expect(snapshot.state).toBe('unknown');
		expect(snapshot.nodes).toEqual([]);
		expect(snapshot.components).toEqual([]);
	});

	test('serves a cached snapshot within the ttl', async () => {
		const service = makeService();
		const first = await service.getSnapshot();
		nodes = [node('node-1'), node('node-2')];
		const second = await service.getSnapshot();
		expect(second.sampledAt).toBe(first.sampledAt);
		expect(second.nodesTotal).toBe(1);
	});
});
