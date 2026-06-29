import { describe, expect, mock, test } from 'bun:test';

const patchCalls: Array<{ kind: string; fieldManager: string; force: boolean; strategy: string }> = [];
type PatchedObject = {
	kind: string;
	metadata?: { labels?: Record<string, string> };
	spec?: { template?: { spec?: { nodeSelector?: Record<string, string> } } };
};
const patchedObjects: PatchedObject[] = [];
const deleteCalls: Array<{ kind: string }> = [];
let failOnKind: string | null = null;
let deleteNotFoundForKind: string | null = null;

mock.module('@kubernetes/client-node', () => ({
	PatchStrategy: { ServerSideApply: 'application/apply-patch+yaml' },
	KubernetesObjectApi: {
		makeApiClient: () => ({
			patch: async (obj: { kind: string }, _pretty: unknown, _dryRun: unknown, fieldManager: string, force: boolean, strategy: string) => {
				if (failOnKind && obj.kind === failOnKind) throw new Error('boom');
				patchCalls.push({ kind: obj.kind, fieldManager, force, strategy });
				patchedObjects.push(obj);
				return obj;
			},
			delete: async (obj: { kind: string }) => {
				deleteCalls.push({ kind: obj.kind });
				if (deleteNotFoundForKind && obj.kind === deleteNotFoundForKind) throw { code: 404 };
			}
		})
	}
}));

const { parseManifest, applyManifest, deleteManifest } = await import('../src/lib/k8s-apply.js');

const MANIFEST = `
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: csi-node
  namespace: gce-pd-csi-driver
---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: volumesnapshotclasses.snapshot.storage.k8s.io
---
apiVersion: v1
kind: Namespace
metadata:
  name: gce-pd-csi-driver
---
# an empty doc below should be ignored
---
`;

describe('parseManifest', () => {
	test('parses valid docs and skips empty/invalid ones', () => {
		const objs = parseManifest(MANIFEST);
		expect(objs.map(o => o.kind)).toEqual(['DaemonSet', 'CustomResourceDefinition', 'Namespace']);
	});
});

describe('applyManifest', () => {
	test('applies Namespace then CRD then other objects, via forced server-side apply', async () => {
		patchCalls.length = 0;
		const kc = {} as never;
		const count = await applyManifest(kc, MANIFEST);
		expect(count).toBe(3);
		expect(patchCalls.map(c => c.kind)).toEqual(['Namespace', 'CustomResourceDefinition', 'DaemonSet']);
		expect(patchCalls.every(c => c.fieldManager === 'kubwave')).toBe(true);
		expect(patchCalls.every(c => c.force === true)).toBe(true);
		expect(patchCalls.every(c => c.strategy === 'application/apply-patch+yaml')).toBe(true);
	});

	test('wraps a failing object apply with its kind and name', async () => {
		patchCalls.length = 0;
		failOnKind = 'DaemonSet';
		const kc = {} as never;
		await expect(applyManifest(kc, MANIFEST)).rejects.toThrow(/Failed to apply DaemonSet\/csi-node: boom/);
		failOnKind = null;
	});

	test('stamps ownership labels on every object and merges nodeSelector into pod-templated workloads', async () => {
		patchedObjects.length = 0;
		const kc = {} as never;
		const manifest = `
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: csi-node
spec:
  template:
    spec:
      nodeSelector:
        kubernetes.io/os: linux
      containers: []
---
apiVersion: v1
kind: Namespace
metadata:
  name: gce-pd-csi-driver
`;
		await applyManifest(kc, manifest, {
			labels: { 'app.kubernetes.io/managed-by': 'kubwave-cli' },
			nodeSelector: { 'cfke.io/provider': 'gcp' }
		});

		const ds = patchedObjects.find(o => o.kind === 'DaemonSet');
		const ns = patchedObjects.find(o => o.kind === 'Namespace');

		// Ownership label lands on every object — the Namespace anchor uninstall checks, plus the workloads.
		expect(ds?.metadata?.labels?.['app.kubernetes.io/managed-by']).toBe('kubwave-cli');
		expect(ns?.metadata?.labels?.['app.kubernetes.io/managed-by']).toBe('kubwave-cli');
		// Provider pin merges into the pod template, preserving the upstream os selector.
		expect(ds?.spec?.template?.spec?.nodeSelector).toEqual({ 'kubernetes.io/os': 'linux', 'cfke.io/provider': 'gcp' });
		// Non-pod-templated objects (Namespace) get no nodeSelector.
		expect(ns?.spec).toBeUndefined();
	});
});

describe('deleteManifest', () => {
	test('deletes in reverse apply order — Namespace last', async () => {
		deleteCalls.length = 0;
		const kc = {} as never;
		const count = await deleteManifest(kc, MANIFEST);
		expect(count).toBe(3);
		// DaemonSet (rank 2) first, CRD (rank 1) second, Namespace (rank 0) last
		expect(deleteCalls.map(c => c.kind)).toEqual(['DaemonSet', 'CustomResourceDefinition', 'Namespace']);
	});

	test('tolerates NotFound errors — skips missing objects without throwing', async () => {
		deleteCalls.length = 0;
		deleteNotFoundForKind = 'DaemonSet';
		const kc = {} as never;
		const count = await deleteManifest(kc, MANIFEST);
		expect(count).toBe(3);
		expect(deleteCalls.map(c => c.kind)).toEqual(['DaemonSet', 'CustomResourceDefinition', 'Namespace']);
		deleteNotFoundForKind = null;
	});
});
