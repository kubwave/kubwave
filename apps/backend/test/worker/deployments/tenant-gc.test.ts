import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AppsV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import { LABEL_ENVIRONMENT_ID, LABEL_MANAGED_BY, LABEL_SERVICE_ID, MANAGED_BY_VALUE } from '@kubwave/kube';

// gcOrphans: an environment with no live services → delete the namespace; else reap only workloads whose service row is gone (+ tear networking down).

// One db.select result per namespace visited.
let liveServiceResults: Array<Array<{ id: string }>> = [];
let liveIdx = 0;
const teardownNetworkingCalls: Array<{ namespace: string; serviceId: string }> = [];

mock.module('@kubwave/db', () => ({
	services: { id: 'id', environmentId: 'environmentId' },
	db: {
		select: () => ({ from: () => ({ where: async () => liveServiceResults[liveIdx++] ?? [] }) })
	}
}));
mock.module('~/shared/cluster/networking', () => ({
	teardownNetworking: async (args: { namespace: string; serviceId: string }) => {
		teardownNetworkingCalls.push({ namespace: args.namespace, serviceId: args.serviceId });
	}
}));

const { gcOrphans } = await import('~/modules/worker/jobs/deployments/tenant-gc');

// Mutable fakes the tests configure per case.
let namespaceItems: unknown[] = [];
let deploymentItems: unknown[] = [];
const deletedNamespaces: string[] = [];
const deletedWorkloads: Array<{ name: string; namespace: string }> = [];

const coreApi = {
	listNamespace: async () => ({ items: namespaceItems }),
	deleteNamespace: async ({ name }: { name: string }) => {
		deletedNamespaces.push(name);
	}
};
const appsApi = {
	listNamespacedDeployment: async () => ({ items: deploymentItems }),
	deleteNamespacedDeployment: async ({ name, namespace }: { name: string; namespace: string }) => {
		deletedWorkloads.push({ name, namespace });
	}
};
const netApi = {};

const kc = {
	makeApiClient: (cls: unknown) => {
		if (cls === AppsV1Api) return appsApi;
		if (cls === CoreV1Api) return coreApi;
		if (cls === NetworkingV1Api) return netApi;
		return {};
	}
} as unknown as KubeConfig;

function managedNamespace(name: string, environmentId: string | undefined) {
	const labels: Record<string, string> = { [LABEL_MANAGED_BY]: MANAGED_BY_VALUE };
	if (environmentId) labels[LABEL_ENVIRONMENT_ID] = environmentId;
	return { metadata: { name, labels } };
}

afterEach(() => {
	liveServiceResults = [];
	liveIdx = 0;
	teardownNetworkingCalls.length = 0;
	namespaceItems = [];
	deploymentItems = [];
	deletedNamespaces.length = 0;
	deletedWorkloads.length = 0;
});

describe('gcOrphans', () => {
	test('drops a namespace whose environment has no live services', async () => {
		namespaceItems = [managedNamespace('kubwave-env-1', 'env-1')];
		liveServiceResults = [[]]; // env-1 → no services
		await gcOrphans(kc);
		expect(deletedNamespaces).toEqual(['kubwave-env-1']);
		expect(deletedWorkloads).toEqual([]);
	});

	test('skips namespaces missing name or environment-id label', async () => {
		namespaceItems = [
			{ metadata: { name: undefined, labels: { [LABEL_MANAGED_BY]: MANAGED_BY_VALUE } } },
			managedNamespace('kubwave-env-x', undefined) // no env label
		];
		await gcOrphans(kc);
		expect(deletedNamespaces).toEqual([]);
		// Never queried services for either skipped namespace.
		expect(liveIdx).toBe(0);
	});

	test('reaps an orphaned workload (service gone) but keeps the namespace', async () => {
		namespaceItems = [managedNamespace('kubwave-env-2', 'env-2')];
		liveServiceResults = [[{ id: 'svc-live' }]]; // env still has a service → namespace stays
		deploymentItems = [
			{ metadata: { name: 'svc-svc-live', labels: { [LABEL_SERVICE_ID]: 'svc-live' } } }, // live → kept
			{ metadata: { name: 'svc-svc-gone', labels: { [LABEL_SERVICE_ID]: 'svc-gone' } } } // orphan → reaped
		];
		await gcOrphans(kc);
		expect(deletedNamespaces).toEqual([]);
		expect(deletedWorkloads).toEqual([{ name: 'svc-svc-gone', namespace: 'kubwave-env-2' }]);
		expect(teardownNetworkingCalls).toEqual([{ namespace: 'kubwave-env-2', serviceId: 'svc-gone' }]);
	});

	test('skips workloads missing a service-id or name label', async () => {
		namespaceItems = [managedNamespace('kubwave-env-3', 'env-3')];
		liveServiceResults = [[{ id: 'svc-live' }]];
		deploymentItems = [
			{ metadata: { name: 'no-svc-label', labels: {} } }, // no service-id
			{ metadata: { name: undefined, labels: { [LABEL_SERVICE_ID]: 'svc-gone' } } } // no name
		];
		await gcOrphans(kc);
		expect(deletedWorkloads).toEqual([]);
		expect(teardownNetworkingCalls).toEqual([]);
	});
});
