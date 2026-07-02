import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import * as realK8sApply from '../src/lib/k8s-apply.js';
import { clackStub } from './support/clack-stub.js';

interface CrItem {
	metadata?: { name?: string; namespace?: string; finalizers?: string[] };
}

const promptEvents: string[] = [];
const mergePatchCalls: Array<{ apiVersion: string; kind: string; name?: string; namespace?: string; finalizers?: string[] }> = [];

// Keyed by `${apiVersion}|${kind}`; a value that is an Error is thrown by listAllCustomObjects.
let crsByKind: Record<string, CrItem[] | Error> = {};
let crdItems: Array<{ metadata?: { name?: string }; spec?: unknown }> = [];
let listCrdError: Error | null = null;
// When set, mergePatch throws it (once per call) — exercises tolerated vs. propagated patch failures.
let mergePatchError: Error | null = null;

const crdApi = {
	listCustomResourceDefinition: async () => {
		if (listCrdError) throw listCrdError;
		return { items: crdItems };
	}
};

mock.module('@clack/prompts', () => ({
	...clackStub(),
	log: {
		...clackStub().log,
		warn: (msg: string) => promptEvents.push(`warn:${msg}`)
	},
	spinner: () => ({
		start: (msg: string) => promptEvents.push(`start:${msg}`),
		stop: (msg: string) => promptEvents.push(`stop:${msg}`)
	})
}));

mock.module('~/lib/k8s-apply.js', () => ({
	...realK8sApply,
	listAllCustomObjects: async (_kc: unknown, apiVersion: string, kind: string) => {
		const value = crsByKind[`${apiVersion}|${kind}`];
		if (value instanceof Error) throw value;
		return value ?? [];
	},
	mergePatch: async (_kc: unknown, obj: { apiVersion: string; kind: string; metadata?: { name?: string; namespace?: string; finalizers?: string[] } }) => {
		if (mergePatchError) throw mergePatchError;
		mergePatchCalls.push({
			apiVersion: obj.apiVersion,
			kind: obj.kind,
			name: obj.metadata?.name,
			namespace: obj.metadata?.namespace,
			finalizers: obj.metadata?.finalizers
		});
	}
}));

const { drainDependencyCustomResources } = await import('../src/commands/uninstall.js');

const mockKc = { makeApiClient: () => crdApi } as unknown as KubeConfig;

function crd(name: string, group: string, kind: string, version = 'v1'): { metadata: { name: string }; spec: unknown } {
	return { metadata: { name }, spec: { group, names: { kind }, versions: [{ name: version, served: true }] } };
}

function basePlan(customResourceDefinitions: string[]): Parameters<typeof drainDependencyCustomResources>[1] {
	return {
		appRelease: { release: 'kubwave', namespace: 'kubwave' },
		stagingRelease: null,
		stagingNamespace: 'kubwave-staging',
		stagingNamespaceExists: false,
		deletePvcs: false,
		acmeAccountSecrets: [],
		dependencyReleases: [],
		namespacesToDelete: [],
		environmentNamespaces: [],
		clusterRoles: [],
		clusterRoleBindings: [],
		customResourceDefinitions,
		csiTeardowns: []
	};
}

function reset(): void {
	promptEvents.length = 0;
	mergePatchCalls.length = 0;
	crsByKind = {};
	crdItems = [];
	listCrdError = null;
	mergePatchError = null;
}

describe('drainDependencyCustomResources', () => {
	test('no-ops when there are no dependency CRDs', async () => {
		reset();
		await drainDependencyCustomResources(mockKc, basePlan([]));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents).toHaveLength(0);
	});

	test('clears finalizers only on the targeted CRDs’ resources that actually have finalizers', async () => {
		reset();
		crdItems = [
			crd('challenges.acme.cert-manager.io', 'acme.cert-manager.io', 'Challenge'),
			crd('clusters.postgresql.cnpg.io', 'postgresql.cnpg.io', 'Cluster'),
			// present on the cluster but NOT in the plan — must be left untouched
			crd('widgets.example.com', 'example.com', 'Widget')
		];
		crsByKind = {
			'acme.cert-manager.io/v1|Challenge': [
				{ metadata: { name: 'chal-1', namespace: 'kubwave', finalizers: ['finalizer.acme.cert-manager.io'] } },
				{ metadata: { name: 'chal-2', namespace: 'kubwave' } } // no finalizers → skip
			],
			'postgresql.cnpg.io/v1|Cluster': [{ metadata: { name: 'pg', namespace: 'kubwave', finalizers: ['cnpg.io/deleteClaim'] } }],
			'example.com/v1|Widget': [{ metadata: { name: 'w', namespace: 'kubwave', finalizers: ['x'] } }]
		};

		await drainDependencyCustomResources(mockKc, basePlan(['challenges.acme.cert-manager.io', 'clusters.postgresql.cnpg.io']));

		expect(mergePatchCalls).toEqual([
			{ apiVersion: 'acme.cert-manager.io/v1', kind: 'Challenge', name: 'chal-1', namespace: 'kubwave', finalizers: [] },
			{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'pg', namespace: 'kubwave', finalizers: [] }
		]);
		expect(promptEvents).toContain('stop:Cleared finalizers on 2 leftover resource(s)');
	});

	test('reports when nothing needed cleanup', async () => {
		reset();
		crdItems = [crd('challenges.acme.cert-manager.io', 'acme.cert-manager.io', 'Challenge')];
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': [] };
		await drainDependencyCustomResources(mockKc, basePlan(['challenges.acme.cert-manager.io']));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents).toContain('stop:No leftover dependency resources needed finalizer cleanup');
	});

	test('a NotFound on the kind listing (CRD already gone) is skipped silently', async () => {
		reset();
		crdItems = [crd('challenges.acme.cert-manager.io', 'acme.cert-manager.io', 'Challenge')];
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': Object.assign(new Error('gone'), { code: 404 }) };
		await drainDependencyCustomResources(mockKc, basePlan(['challenges.acme.cert-manager.io']));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('warn:'))).toBe(false);
	});

	test('a non-NotFound listing error warns but does not throw', async () => {
		reset();
		crdItems = [crd('challenges.acme.cert-manager.io', 'acme.cert-manager.io', 'Challenge')];
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': Object.assign(new Error('forbidden'), { code: 403 }) };
		await drainDependencyCustomResources(mockKc, basePlan(['challenges.acme.cert-manager.io']));
		expect(promptEvents.some(e => e.startsWith('warn:') && e.includes('Challenge'))).toBe(true);
	});

	test('a NotFound patch (raced deletion) is tolerated', async () => {
		reset();
		crdItems = [crd('challenges.acme.cert-manager.io', 'acme.cert-manager.io', 'Challenge')];
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': [{ metadata: { name: 'chal-1', namespace: 'kubwave', finalizers: ['x'] } }] };
		mergePatchError = Object.assign(new Error('gone'), { code: 404 });
		await drainDependencyCustomResources(mockKc, basePlan(['challenges.acme.cert-manager.io']));
		expect(promptEvents.some(e => e.startsWith('warn:'))).toBe(false);
		expect(promptEvents).toContain('stop:No leftover dependency resources needed finalizer cleanup');
	});

	test('a failure to list CRDs warns and returns without patching', async () => {
		reset();
		listCrdError = new Error('api down');
		await drainDependencyCustomResources(mockKc, basePlan(['challenges.acme.cert-manager.io']));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents).toContain('stop:Skipped finalizer cleanup (could not list CRDs)');
		expect(promptEvents.some(e => e.startsWith('warn:') && e.includes('api down'))).toBe(true);
	});
});
