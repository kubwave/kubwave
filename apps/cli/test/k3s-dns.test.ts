import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig, V1Service } from '@kubernetes/client-node';
import { clackStub } from './support/clack-stub.js';

mock.module('@clack/prompts', () => clackStub());

const { resolveK3sDnsPolicy } = await import('../src/platforms/k3s/dns.js');
const { FatalCliError } = await import('../src/lib/errors.js');

function kubeConfigWith(readNamespacedService: (args: { namespace: string; name: string }) => Promise<V1Service>): KubeConfig {
	return { makeApiClient: () => ({ readNamespacedService }) } as never;
}

function serviceWith(spec: V1Service['spec']): KubeConfig {
	return kubeConfigWith(async () => ({ spec }));
}

describe('resolveK3sDnsPolicy', () => {
	test('reads the ClusterIP and pod selector of kube-system/kube-dns', async () => {
		let requested: { namespace: string; name: string } | undefined;
		const kc = kubeConfigWith(async args => {
			requested = args;
			return { spec: { clusterIP: '10.43.0.10', selector: { 'k8s-app': 'kube-dns' } } };
		});
		expect(await resolveK3sDnsPolicy(kc)).toEqual({
			namespace: 'kube-system',
			podLabels: { 'k8s-app': 'kube-dns' },
			serviceIp: '10.43.0.10/32'
		});
		expect(requested).toEqual({ namespace: 'kube-system', name: 'kube-dns' });
	});

	test('follows a non-default --service-cidr/--cluster-dns and a replaced CoreDNS selector', async () => {
		const policy = await resolveK3sDnsPolicy(serviceWith({ clusterIP: '10.100.0.10', selector: { app: 'my-dns' } }));
		expect(policy.serviceIp).toBe('10.100.0.10/32');
		expect(policy.podLabels).toEqual({ app: 'my-dns' });
	});

	test('uses a /128 for an IPv6 ClusterIP', async () => {
		const policy = await resolveK3sDnsPolicy(serviceWith({ clusterIP: 'fd00:43::a', selector: { 'k8s-app': 'kube-dns' } }));
		expect(policy.serviceIp).toBe('fd00:43::a/128');
	});

	test('omits the service IP for a headless Service and keeps the k3s labels without a selector', async () => {
		const policy = await resolveK3sDnsPolicy(serviceWith({ clusterIP: 'None' }));
		expect(policy.serviceIp).toBe('');
		expect(policy.podLabels).toEqual({ 'k8s-app': 'kube-dns' });
	});

	test('fails with guidance when the kube-dns Service is missing', async () => {
		const kc = kubeConfigWith(async () => {
			throw { code: 404 };
		});
		await expect(resolveK3sDnsPolicy(kc)).rejects.toBeInstanceOf(FatalCliError);
		await expect(resolveK3sDnsPolicy(kc)).rejects.toThrow('--disable=coredns');
	});

	test('surfaces unexpected API errors', async () => {
		const kc = kubeConfigWith(async () => {
			throw { code: 403 };
		});
		await expect(resolveK3sDnsPolicy(kc)).rejects.toEqual({ code: 403 });
	});
});
