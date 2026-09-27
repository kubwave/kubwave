import { describe, expect, test } from 'bun:test';
import type { V1Node, V1Pod } from '@kubernetes/client-node';
import { nodeConditions, nodeRoles, sumRequests, toNodeDto } from '~/modules/platform/cluster/node-mapper';

function node(overrides: Partial<V1Node> = {}): V1Node {
	return {
		metadata: { name: 'node-1', labels: { 'node-role.kubernetes.io/control-plane': '' } },
		spec: { unschedulable: false },
		status: {
			allocatable: { cpu: '4', memory: '8Gi', pods: '110' },
			conditions: [{ type: 'Ready', status: 'True' }],
			nodeInfo: { kubeletVersion: 'v1.31.2' }
		},
		...overrides
	} as V1Node;
}

describe('node-mapper', () => {
	test('maps roles from the node-role label prefix', () => {
		expect(nodeRoles(node())).toEqual(['control-plane']);
	});

	test('reports a condition as false when absent', () => {
		expect(nodeConditions(node())).toEqual({ ready: true, memoryPressure: false, diskPressure: false, pidPressure: false });
	});

	test('excludes terminated pods from requests', () => {
		const pods = [
			{ spec: { containers: [{ resources: { requests: { cpu: '500m', memory: '1Gi' } } }] }, status: { phase: 'Running' } },
			{ spec: { containers: [{ resources: { requests: { cpu: '2', memory: '4Gi' } } }] }, status: { phase: 'Failed' } }
		] as unknown as V1Pod[];
		expect(sumRequests(pods)).toEqual({ cpuMillicores: 500, memoryBytes: 1024 ** 3, count: 1 });
	});

	test('counts init containers, native sidecars and overhead the way the scheduler does', () => {
		const requests = (cpu: string) => ({ resources: { requests: { cpu } } });
		const pods = [
			{
				spec: {
					initContainers: [requests('100m'), { ...requests('50m'), restartPolicy: 'Always' }, requests('800m')],
					containers: [requests('200m'), requests('300m')],
					overhead: { cpu: '10m' }
				},
				status: { phase: 'Running' }
			}
		] as unknown as V1Pod[];
		// max(app 500 + sidecar 50, init 800 + sidecar 50 started before it) + overhead 10
		expect(sumRequests(pods).cpuMillicores).toBe(860);
	});

	test('builds the meters from allocatable, requests and usage', () => {
		const dto = toNodeDto(
			node(),
			{ nodeName: 'node-1', available: true, cpuMillicores: 1000, memoryBytes: 1024 ** 3, fsUsedBytes: 100, fsCapacityBytes: 1000 },
			{ cpuMillicores: 750, memoryBytes: 512, count: 13 }
		);
		expect(dto.cpu).toEqual({ capacity: 4000, requested: 750, used: 1000 });
		expect(dto.disk).toEqual({ capacity: 1000, requested: null, used: 100 });
		expect(dto.pods).toEqual({ capacity: 110, requested: null, used: 13 });
		expect(dto.kubeletVersion).toBe('v1.31.2');
	});

	test('leaves usage null when the kubelet reported nothing for the node', () => {
		const dto = toNodeDto(node(), undefined, { cpuMillicores: 0, memoryBytes: 0, count: 0 });
		expect(dto.cpu.used).toBeNull();
		expect(dto.memory.used).toBeNull();
	});
});
