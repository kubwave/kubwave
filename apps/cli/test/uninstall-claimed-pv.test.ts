import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig, V1PersistentVolume } from '@kubernetes/client-node';
import * as realK8sApply from '../src/lib/k8s-apply.js';
import { clackStub } from './support/clack-stub.js';

const promptEvents: string[] = [];
const mergePatchCalls: Array<{ name?: string; finalizers?: string[]; reclaimPolicy?: string }> = [];
const deletedPvNames: string[] = [];

let listedPvs: V1PersistentVolume[] = [];
let listQueue: V1PersistentVolume[][] = [];

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
		message: (msg: string) => promptEvents.push(`message:${msg}`),
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
	listPersistentVolume: async () => ({ items: listQueue.length > 0 ? listQueue.shift()! : listedPvs, metadata: {} }),
	deletePersistentVolume: async ({ name }: { name: string }) => {
		deletedPvNames.push(name);
	},
	setDefaultNamespace: () => {}
};

const mockKc = { makeApiClient: () => api } as unknown as KubeConfig;

const { reclaimClaimedPersistentVolumes } = await import('../src/commands/uninstall.js');

function plan(): Parameters<typeof reclaimClaimedPersistentVolumes>[1] {
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

function pv(name: string, claimNs: string, phase: string, reclaimPolicy: 'Retain' | 'Delete' = 'Delete'): V1PersistentVolume {
	return {
		metadata: { name, finalizers: ['kubernetes.io/pv-protection'] },
		spec: { claimRef: { namespace: claimNs }, persistentVolumeReclaimPolicy: reclaimPolicy },
		status: { phase }
	} as V1PersistentVolume;
}

function reset(): void {
	promptEvents.length = 0;
	mergePatchCalls.length = 0;
	deletedPvNames.length = 0;
	listedPvs = [];
	listQueue = [];
}

describe('reclaimClaimedPersistentVolumes disk-safety', () => {
	test('never deletes the PV object directly — reclaim is left to the CSI provisioner', async () => {
		reset();
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Retain')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(deletedPvNames).toHaveLength(0);
	});

	test('patches a Retain PV to Delete and reports it reclaimed once the provisioner removes it', async () => {
		reset();
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Retain')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(mergePatchCalls.some(c => c.name === 'pv-released' && c.reclaimPolicy === 'Delete')).toBe(true);
		expect(deletedPvNames).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('stop:') && e.includes('Reclaimed 1'))).toBe(true);
	});

	test('does not patch a PV that already uses the Delete reclaimPolicy', async () => {
		reset();
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Delete')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(mergePatchCalls).toHaveLength(0);
		expect(deletedPvNames).toHaveLength(0);
	});

	test('ignores PVs claimed outside the removed namespaces', async () => {
		reset();
		listQueue = [[pv('pv-other', 'some-other-ns', 'Released', 'Retain')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('stop:') && e.includes('No claimed PersistentVolumes'))).toBe(true);
	});
});

describe('reclaimClaimedPersistentVolumes polling', () => {
	test('polls until a Bound PV turns Released and the provisioner reclaims it', async () => {
		reset();
		listQueue = [[pv('pv-bound', 'env-tenant-a', 'Bound', 'Retain')], [pv('pv-bound', 'env-tenant-a', 'Released', 'Retain')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { timeoutMs: 5_000, pollMs: 1 });

		expect(mergePatchCalls.some(c => c.name === 'pv-bound' && c.reclaimPolicy === 'Delete')).toBe(true);
		expect(deletedPvNames).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('stop:') && e.includes('Reclaimed 1'))).toBe(true);
	});

	test('stops at the deadline, reports PVs not reclaimed, and still never deletes them', async () => {
		reset();
		listedPvs = [pv('pv-stuck', 'env-tenant-a', 'Released', 'Delete')];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { timeoutMs: 20, pollMs: 1 });

		expect(deletedPvNames).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('stop:') && e.includes('not reclaimed within timeout'))).toBe(true);
	});

	test('flags persistently Bound PVs as still bound at the deadline', async () => {
		reset();
		listedPvs = [pv('pv-bound', 'env-tenant-a', 'Bound', 'Delete')];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { timeoutMs: 20, pollMs: 1 });

		expect(deletedPvNames).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('stop:') && e.includes('still bound'))).toBe(true);
	});
});
