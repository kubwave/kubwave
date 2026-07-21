import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig, V1PersistentVolume } from '@kubernetes/client-node';
import * as realK8sApply from '../src/lib/k8s-apply.js';
import { clackStub } from './support/clack-stub.js';

const promptEvents: string[] = [];
const mergePatchCalls: Array<{ name?: string; finalizers?: string[]; reclaimPolicy?: string; resourceVersion?: string }> = [];
const deletedPvNames: string[] = [];

let listedPvs: V1PersistentVolume[] = [];
let listQueue: V1PersistentVolume[][] = [];
let failReclaimFor: Set<string> = new Set();
let stripConflicts = 0;

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
		obj: { metadata?: { name?: string; finalizers?: string[]; resourceVersion?: string }; spec?: { persistentVolumeReclaimPolicy?: string } }
	) => {
		const name = obj.metadata?.name;
		const isStrip = obj.metadata?.finalizers !== undefined;
		const isReclaim = obj.spec?.persistentVolumeReclaimPolicy === 'Delete';
		if (isStrip && stripConflicts > 0) {
			stripConflicts--;
			const err = new Error('the object has been modified; please apply your changes to the latest version') as Error & { statusCode?: number };
			err.statusCode = 409;
			throw err;
		}
		mergePatchCalls.push({
			name,
			finalizers: obj.metadata?.finalizers,
			reclaimPolicy: obj.spec?.persistentVolumeReclaimPolicy,
			resourceVersion: obj.metadata?.resourceVersion
		});
		if (isReclaim && name && failReclaimFor.has(name)) {
			const err = new Error('simulated transient API failure') as Error & { statusCode?: number };
			err.statusCode = 500;
			throw err;
		}
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

function pv(
	name: string,
	claimNs: string,
	phase: string,
	reclaimPolicy: 'Retain' | 'Delete' = 'Delete',
	finalizers: string[] = ['kubernetes.io/pv-protection']
): V1PersistentVolume {
	return {
		metadata: { name, finalizers },
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
	failReclaimFor = new Set();
	stripConflicts = 0;
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

	test('does not patch reclaimPolicy on a PV that already uses Delete', async () => {
		reset();
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Delete', [])], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(mergePatchCalls).toHaveLength(0);
		expect(deletedPvNames).toHaveLength(0);
	});

	test('strips a lingering pv-protection finalizer from a Released PV without deleting the PV object', async () => {
		reset();
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Delete')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		const strip = mergePatchCalls.find(c => c.name === 'pv-released' && c.finalizers !== undefined);
		expect(strip?.finalizers).toEqual([]);
		expect(mergePatchCalls.some(c => c.reclaimPolicy === 'Delete')).toBe(false);
		expect(deletedPvNames).toHaveLength(0);
	});

	test('sends the PV resourceVersion with the strip so a stale read cannot clobber concurrent finalizer changes', async () => {
		reset();
		const target = pv('pv-released', 'env-tenant-a', 'Released', 'Delete');
		target.metadata!.resourceVersion = '12345';
		listQueue = [[target], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		const strip = mergePatchCalls.find(c => c.finalizers !== undefined);
		expect(strip?.resourceVersion).toBe('12345');
	});

	test('keeps pv-protection when the Retain→Delete patch fails, so the disk stays protected for the next retry', async () => {
		reset();
		failReclaimFor = new Set(['pv-released']);
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Retain')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(mergePatchCalls.some(c => c.reclaimPolicy === 'Delete')).toBe(true);
		expect(mergePatchCalls.some(c => c.finalizers !== undefined)).toBe(false);
		expect(deletedPvNames).toHaveLength(0);
	});

	test('treats a 409 conflict on the strip as retryable: no warning, re-read and stripped on the next poll', async () => {
		reset();
		stripConflicts = 1;
		listQueue = [[pv('pv-released', 'env-tenant-a', 'Released', 'Delete')], [pv('pv-released', 'env-tenant-a', 'Released', 'Delete')], []];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { pollMs: 1 });

		expect(mergePatchCalls.some(c => c.finalizers !== undefined)).toBe(true);
		expect(promptEvents.some(e => e.startsWith('warn:') && e.includes('pv-protection'))).toBe(false);
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

	test('flags persistently Bound PVs as still bound and never strips their pv-protection', async () => {
		reset();
		listedPvs = [pv('pv-bound', 'env-tenant-a', 'Bound', 'Delete')];

		await reclaimClaimedPersistentVolumes(mockKc, plan(), { timeoutMs: 20, pollMs: 1 });

		expect(mergePatchCalls.some(c => c.finalizers !== undefined)).toBe(false);
		expect(deletedPvNames).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('stop:') && e.includes('still bound'))).toBe(true);
	});
});
