import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig, V1PersistentVolume } from '@kubernetes/client-node';
import * as realK8sApply from '../src/lib/k8s-apply.js';
import { clackStub } from './support/clack-stub.js';

const promptEvents: string[] = [];
const mergePatchCalls: Array<{ name?: string; finalizers?: string[]; reclaimPolicy?: string }> = [];
const deletedPvNames: string[] = [];

let listedPvs: V1PersistentVolume[] = [];

mock.module('@clack/prompts', () => ({
	...clackStub(),
	log: {
		...clackStub().log,
		info: () => {},
		success: () => {},
		warn: (msg: string) => promptEvents.push(`warn:${msg}`)
	},
	spinner: () => ({
		start: (msg: string) => promptEvents.push(`start:${msg}`),
		stop: (msg: string) => promptEvents.push(`stop:${msg}`)
	})
}));

mock.module('~/lib/k8s-apply.js', () => ({
	...realK8sApply,
	mergePatchWith: async (
		_api: unknown,
		obj: { metadata?: { name?: string; finalizers?: string[] }; spec?: { persistentVolumeReclaimPolicy?: string } }
	) => {
		mergePatchCalls.push({
			name: obj.metadata?.name,
			finalizers: obj.metadata?.finalizers,
			reclaimPolicy: obj.spec?.persistentVolumeReclaimPolicy
		});
	}
}));

const api = {
	listPersistentVolume: async () => ({ items: listedPvs, metadata: {} }),
	deletePersistentVolume: async ({ name }: { name: string }) => {
		deletedPvNames.push(name);
	},
	setDefaultNamespace: () => {}
};

const mockKc = { makeApiClient: () => api } as unknown as KubeConfig;

const { deleteClaimedPersistentVolumes } = await import('../src/commands/uninstall.js');

function plan(): Parameters<typeof deleteClaimedPersistentVolumes>[1] {
	return {
		appRelease: { release: 'kubwave', namespace: 'kubwave' },
		stagingRelease: null,
		stagingNamespace: 'kubwave-staging',
		stagingNamespaceExists: false,
		deletePvcs: false,
		acmeAccountSecrets: [],
		dependencyReleases: [],
		namespacesToDelete: [],
		environmentNamespaces: ['env-tenant-a'],
		clusterRoles: [],
		clusterRoleBindings: [],
		customResourceDefinitions: [],
		csiTeardowns: [],
		upcloudAutoscalerInstalled: false
	};
}

function pv(name: string, claimNs: string, phase: string): V1PersistentVolume {
	return {
		metadata: { name, finalizers: ['kubernetes.io/pv-protection'] },
		spec: { claimRef: { namespace: claimNs }, persistentVolumeReclaimPolicy: 'Delete' },
		status: { phase }
	} as V1PersistentVolume;
}

function reset(): void {
	promptEvents.length = 0;
	mergePatchCalls.length = 0;
	deletedPvNames.length = 0;
	listedPvs = [];
}

describe('deleteClaimedPersistentVolumes phase guard', () => {
	test('skips a still-Bound PV whose namespace is mid-teardown — no finalizer strip, no delete', async () => {
		reset();
		listedPvs = [pv('pv-bound', 'env-tenant-a', 'Bound')];

		await deleteClaimedPersistentVolumes(mockKc, plan());

		expect(deletedPvNames).toHaveLength(0);
		expect(mergePatchCalls).toHaveLength(0);
	});

	test('strips the protection finalizer and deletes a Released PV', async () => {
		reset();
		listedPvs = [pv('pv-released', 'env-tenant-a', 'Released')];

		await deleteClaimedPersistentVolumes(mockKc, plan());

		expect(deletedPvNames).toEqual(['pv-released']);
		expect(mergePatchCalls.some(c => c.name === 'pv-released' && !(c.finalizers ?? []).includes('kubernetes.io/pv-protection'))).toBe(true);
	});

	test('processes only the Released PV when Bound and Released share the sweep', async () => {
		reset();
		listedPvs = [pv('pv-bound', 'env-tenant-a', 'Bound'), pv('pv-released', 'kubwave', 'Released')];

		await deleteClaimedPersistentVolumes(mockKc, plan());

		expect(deletedPvNames).toEqual(['pv-released']);
	});
});
