import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import * as realK8s from '../src/lib/k8s.js';
import * as realHelm from '../src/lib/helm.js';
import { clackStub } from './support/clack-stub.js';

const helmListReleases: Record<string, string[]> = {};
let csiDrivers: Array<{ metadata: { name: string; labels?: Record<string, string> } }> = [];

const api = {
	readNamespace: async ({ name }: { name: string }) => {
		if (name === 'kubwave-staging') throw { code: 404 };
		return { metadata: { name } };
	},
	listPersistentVolume: async () => ({ items: [], metadata: {} }),
	readStorageClass: async ({ name }: { name: string }) => ({ metadata: { name } }),
	listCSIDriver: async () => ({ items: csiDrivers }),
	listNamespace: async () => ({ items: [] }),
	listClusterRole: async () => ({ items: [] }),
	listClusterRoleBinding: async () => ({ items: [] }),
	listCustomResourceDefinition: async () => ({ items: [] }),
	listNamespacedPersistentVolumeClaim: async () => ({ items: [] }),
	readNamespacedDeployment: async ({ name }: { name: string; namespace: string }) => {
		if (name === 'cluster-autoscaler') {
			return { metadata: { name, labels: autoscalerDeploymentLabels } };
		}
		throw { code: 404 };
	}
};

let autoscalerDeploymentLabels: Record<string, string> | undefined;

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => true),
	isCancel: () => false
}));

mock.module('~/lib/k8s.js', () => ({
	...realK8s,
	loadKubeConfig: () => ({ makeApiClient: () => api }) as unknown as KubeConfig,
	getClusterInfo: () => ({ server: 'https://cluster.example', context: 'test-context' })
}));

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	helmUninstall: async () => ({ removed: true }),
	listReleaseNames: async (namespace: string) => helmListReleases[namespace] ?? []
}));

const { buildUninstallPlan } = await import('../src/commands/uninstall.js');

const mockKc = { makeApiClient: () => api } as unknown as KubeConfig;

describe('upcloud-uks uninstall CSI safety', () => {
	test('does not detect UKS CSI (storage.csi.upcloud.com) without kubwave ownership labels', async () => {
		csiDrivers = [{ metadata: { name: 'storage.csi.upcloud.com' } }];
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.csiTeardowns.find(t => t.provisioner === 'storage.csi.upcloud.com')).toBeUndefined();
	});

	test('does not detect UKS CSI when only the driver name matches a non-catalog provisioner', async () => {
		csiDrivers = [
			{
				metadata: {
					name: 'storage.csi.upcloud.com',
					labels: { 'app.kubernetes.io/part-of': 'kubwave' }
				}
			}
		];
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.csiTeardowns.find(t => t.provisioner === 'storage.csi.upcloud.com')).toBeUndefined();
	});

	test('does not flag foreign cluster-autoscaler deployments without kubwave ownership', async () => {
		autoscalerDeploymentLabels = { app: 'cluster-autoscaler' };
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.upcloudAutoscalerInstalled).toBe(false);
	});

	test('detects kubwave-installed UpCloud Cluster Autoscaler for teardown', async () => {
		autoscalerDeploymentLabels = {
			'app.kubernetes.io/part-of': 'kubwave',
			'app.kubernetes.io/managed-by': 'kubwave-cli',
			'app.kubernetes.io/component': 'platform',
			'app.kubernetes.io/instance': 'upcloud-autoscaler'
		};
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.upcloudAutoscalerInstalled).toBe(true);
	});
});
