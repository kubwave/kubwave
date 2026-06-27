import { describe, expect, test } from 'bun:test';
import type { CoreV1Api } from '@kubernetes/client-node';
import { detectNetworkPolicyEnforcement } from '~/shared/cluster/cni';

function coreApiWithPods(names: string[]): CoreV1Api {
	return {
		listNamespacedPod: async () => ({ items: names.map(name => ({ metadata: { name } })) })
	} as unknown as CoreV1Api;
}

describe('detectNetworkPolicyEnforcement', () => {
	test('reports enforced when a policy-enforcing CNI (cilium) is present', async () => {
		const res = await detectNetworkPolicyEnforcement(coreApiWithPods(['coredns-abc', 'cilium-xyz']));
		expect(res).toEqual({ enforced: true, cni: 'cilium-xyz' });
	});

	test('reports NOT enforced for flannel (k3d dev default)', async () => {
		const res = await detectNetworkPolicyEnforcement(coreApiWithPods(['coredns-abc', 'kube-flannel-ds-123']));
		expect(res).toEqual({ enforced: false, cni: 'kube-flannel-ds-123' });
	});

	test('prefers an enforcing CNI over flannel when both somehow appear', async () => {
		const res = await detectNetworkPolicyEnforcement(coreApiWithPods(['kube-flannel-ds-1', 'calico-node-9']));
		expect(res.enforced).toBe(true);
		expect(res.cni).toBe('calico-node-9');
	});

	test('returns unknown when no recognised CNI pods are found', async () => {
		const res = await detectNetworkPolicyEnforcement(coreApiWithPods(['coredns-abc', 'metrics-server-1']));
		expect(res).toEqual({ enforced: null, cni: null });
	});
});
