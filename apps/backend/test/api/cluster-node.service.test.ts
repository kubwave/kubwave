import { ApiException } from '@kubernetes/client-node';
import { beforeEach, describe, expect, mock, test } from 'bun:test';

let nodeItem: unknown = null;
let pods: unknown[] = [];
let events: unknown[] = [];
let readNodeError: unknown = null;
let summaryThrows = false;
let capturedPodSelector = '';
let capturedEventSelector = '';

mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

mock.module('@kubwave/kube', () => ({
	parseCpuToMillicores: (q?: string | null) => (q == null ? null : q.endsWith('m') ? Number(q.slice(0, -1)) : Math.round(Number(q) * 1000)),
	parseMemoryToBytes: (q?: string | null) => {
		if (q == null) return null;
		if (q.endsWith('Gi')) return Number(q.slice(0, -2)) * 1024 ** 3;
		if (q.endsWith('Mi')) return Number(q.slice(0, -2)) * 1024 ** 2;
		return Number(q);
	},
	nodeStatsSummary: async () => {
		if (summaryThrows) throw new Error('node proxy unavailable');
		return {
			node: { nodeName: 'node-1', cpu: { usageNanoCores: 1e9 }, memory: { workingSetBytes: 1024 ** 3 }, fs: { usedBytes: 100, capacityBytes: 1000 } },
			pods: [{ podRef: { name: 'api-1', namespace: 'kubwave' }, cpu: { usageNanoCores: 5e8 }, memory: { workingSetBytes: 512 } }]
		};
	},
	getKubeConfig: () => ({
		makeApiClient: () => ({
			readNode: async () => {
				if (readNodeError) throw readNodeError;
				return nodeItem;
			},
			listPodForAllNamespaces: async ({ fieldSelector }: { fieldSelector: string }) => {
				capturedPodSelector = fieldSelector;
				return { items: pods };
			},
			listEventForAllNamespaces: async ({ fieldSelector }: { fieldSelector: string }) => {
				capturedEventSelector = fieldSelector;
				return { items: events };
			}
		})
	})
}));

const { ClusterNodeService } = await import('~/modules/platform/cluster/cluster-node.service');

beforeEach(() => {
	nodeItem = {
		metadata: { name: 'node-1', labels: { 'node-role.kubernetes.io/control-plane': '' } },
		spec: { unschedulable: false, taints: [{ key: 'node-role.kubernetes.io/control-plane', value: '', effect: 'NoSchedule' }] },
		status: {
			allocatable: { cpu: '4', memory: '8Gi', pods: '110' },
			conditions: [
				{ type: 'Ready', status: 'True', reason: 'KubeletReady', lastTransitionTime: '2026-07-28T10:00:00.000Z' },
				{ type: 'DiskPressure', status: 'False', reason: 'KubeletHasNoDiskPressure', lastTransitionTime: '2026-07-28T10:00:00.000Z' }
			],
			nodeInfo: { kubeletVersion: 'v1.31.2' }
		}
	};
	pods = [
		{
			metadata: { namespace: 'kubwave', name: 'api-1' },
			spec: { containers: [{ resources: { requests: { cpu: '500m', memory: '1Gi' } } }] },
			status: { phase: 'Running' }
		},
		{
			metadata: { namespace: 'kubwave', name: 'migrate-job-1' },
			spec: { containers: [{ resources: { requests: { cpu: '100m', memory: '128Mi' } } }] },
			status: { phase: 'Succeeded' }
		}
	];
	events = [
		{
			metadata: { uid: 'e1', namespace: 'default' },
			reason: 'InvalidDiskCapacity',
			message: 'invalid capacity 0',
			involvedObject: { kind: 'Node', name: 'node-1' },
			count: 1,
			lastTimestamp: '2026-07-30T06:00:00.000Z'
		}
	];
	readNodeError = null;
	summaryThrows = false;
	capturedPodSelector = '';
	capturedEventSelector = '';
});

describe('ClusterNodeService', () => {
	test('scopes the pod and event queries to the node', async () => {
		await new ClusterNodeService().getNode('node-1');
		expect(capturedPodSelector).toBe('spec.nodeName=node-1');
		expect(capturedEventSelector).toBe('type=Warning,involvedObject.kind=Node,involvedObject.name=node-1');
	});

	test('returns the full condition set with reason and transition time', async () => {
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.available).toBe(true);
		expect(detail.unavailableReason).toBeNull();
		expect(detail.conditions).toContainEqual({
			type: 'DiskPressure',
			status: 'False',
			reason: 'KubeletHasNoDiskPressure',
			lastTransitionTime: '2026-07-28T10:00:00.000Z'
		});
	});

	test('formats taints as key=value:Effect', async () => {
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.taints).toEqual(['node-role.kubernetes.io/control-plane:NoSchedule']);
	});

	test('joins pod usage from the kubelet summary', async () => {
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.pods).toEqual([{ namespace: 'kubwave', name: 'api-1', phase: 'Running', cpuMillicores: 500, memoryBytes: 512 }]);
	});

	test('excludes terminated pods from the pod table, matching the header meter', async () => {
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.pods.some(pod => pod.name === 'migrate-job-1')).toBe(false);
		expect(detail.pods).toHaveLength(1);
	});

	test('leaves pod usage null when the summary api fails', async () => {
		summaryThrows = true;
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.available).toBe(true);
		expect(detail.pods[0]!.cpuMillicores).toBeNull();
		expect(detail.node.cpu.used).toBeNull();
	});

	test('reports unavailable with reason not-found for an unknown node', async () => {
		readNodeError = new ApiException(404, 'Not Found', undefined, {});
		const detail = await new ClusterNodeService().getNode('ghost');
		expect(detail.available).toBe(false);
		expect(detail.unavailableReason).toBe('not-found');
		expect(detail.pods).toEqual([]);
	});

	test('reports unavailable with reason unreachable when the connection fails outright', async () => {
		readNodeError = new TypeError('fetch failed');
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.available).toBe(false);
		expect(detail.unavailableReason).toBe('unreachable');
		expect(detail.pods).toEqual([]);
	});

	test('reports unavailable with reason unreachable for a non-404 apiserver error', async () => {
		readNodeError = new ApiException(503, 'Service Unavailable', undefined, {});
		const detail = await new ClusterNodeService().getNode('node-1');
		expect(detail.available).toBe(false);
		expect(detail.unavailableReason).toBe('unreachable');
		expect(detail.pods).toEqual([]);
	});
});
