import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { DependencyCrd } from '../src/commands/uninstall.js';
import * as realK8sApply from '../src/lib/k8s-apply.js';
import { clackStub } from './support/clack-stub.js';

interface CrItem {
	metadata?: { name?: string; namespace?: string; finalizers?: string[] };
}

const promptEvents: string[] = [];
const mergePatchCalls: Array<{ apiVersion: string; kind: string; name?: string; namespace?: string; finalizers?: string[] }> = [];

// Keyed by `${apiVersion}|${kind}`; a value that is an Error is thrown by listAllCustomObjectsWith.
let crsByKind: Record<string, CrItem[] | Error> = {};
// When set, mergePatchWith throws it (once per call) — exercises tolerated vs. surfaced patch failures.
let mergePatchError: Error | null = null;

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
	listAllCustomObjectsWith: async (_api: unknown, apiVersion: string, kind: string) => {
		const value = crsByKind[`${apiVersion}|${kind}`];
		if (value instanceof Error) throw value;
		return value ?? [];
	},
	mergePatchWith: async (
		_api: unknown,
		obj: { apiVersion: string; kind: string; metadata?: { name?: string; namespace?: string; finalizers?: string[] } }
	) => {
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

// KubernetesObjectApi.makeApiClient(kc) does kc.makeApiClient(...).setDefaultNamespace(kc); the client it returns is
// only handed to the mocked helpers above, so a stub carrying setDefaultNamespace is all drain needs.
const mockKc = { makeApiClient: () => ({ setDefaultNamespace: () => {} }) } as unknown as KubeConfig;

const CHALLENGE: DependencyCrd = { name: 'challenges.acme.cert-manager.io', apiVersion: 'acme.cert-manager.io/v1', kind: 'Challenge' };
const CLUSTER: DependencyCrd = { name: 'clusters.postgresql.cnpg.io', apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster' };

function basePlan(customResourceDefinitions: DependencyCrd[]): Parameters<typeof drainDependencyCustomResources>[1] {
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
	mergePatchError = null;
}

describe('drainDependencyCustomResources', () => {
	test('no-ops when there are no dependency CRDs', async () => {
		reset();
		await drainDependencyCustomResources(mockKc, basePlan([]));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents).toHaveLength(0);
	});

	test('clears finalizers only on the targeted resources that actually have finalizers', async () => {
		reset();
		crsByKind = {
			'acme.cert-manager.io/v1|Challenge': [
				{ metadata: { name: 'chal-1', namespace: 'kubwave', finalizers: ['finalizer.acme.cert-manager.io'] } },
				{ metadata: { name: 'chal-2', namespace: 'kubwave' } } // no finalizers → skip
			],
			'postgresql.cnpg.io/v1|Cluster': [{ metadata: { name: 'pg', namespace: 'kubwave', finalizers: ['cnpg.io/deleteClaim'] } }]
		};

		await drainDependencyCustomResources(mockKc, basePlan([CHALLENGE, CLUSTER]));

		expect(mergePatchCalls).toEqual([
			{ apiVersion: 'acme.cert-manager.io/v1', kind: 'Challenge', name: 'chal-1', namespace: 'kubwave', finalizers: [] },
			{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'pg', namespace: 'kubwave', finalizers: [] }
		]);
		expect(promptEvents).toContain('stop:Cleared finalizers on 2 leftover resource(s)');
	});

	test('reports when nothing needed cleanup', async () => {
		reset();
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': [] };
		await drainDependencyCustomResources(mockKc, basePlan([CHALLENGE]));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents).toContain('stop:No leftover dependency resources needed finalizer cleanup');
	});

	test('a NotFound on the kind listing (CRD already gone) is skipped silently', async () => {
		reset();
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': Object.assign(new Error('gone'), { code: 404 }) };
		await drainDependencyCustomResources(mockKc, basePlan([CHALLENGE]));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('warn:'))).toBe(false);
		expect(promptEvents).toContain('stop:No leftover dependency resources needed finalizer cleanup');
	});

	test('a non-NotFound listing error warns AND is reported as a failure, not a clean drain', async () => {
		reset();
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': Object.assign(new Error('forbidden'), { code: 403 }) };
		await drainDependencyCustomResources(mockKc, basePlan([CHALLENGE]));
		expect(promptEvents.some(e => e.startsWith('warn:') && e.includes('Challenge'))).toBe(true);
		expect(promptEvents).toContain('stop:Cleared finalizers on 0 leftover resource(s); 1 could not be cleared (see warnings above)');
	});

	test('a NotFound patch (raced deletion) is tolerated', async () => {
		reset();
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': [{ metadata: { name: 'chal-1', namespace: 'kubwave', finalizers: ['x'] } }] };
		mergePatchError = Object.assign(new Error('gone'), { code: 404 });
		await drainDependencyCustomResources(mockKc, basePlan([CHALLENGE]));
		expect(promptEvents.some(e => e.startsWith('warn:'))).toBe(false);
		expect(promptEvents).toContain('stop:No leftover dependency resources needed finalizer cleanup');
	});

	test('a non-NotFound patch failure is surfaced instead of masked as a clean drain', async () => {
		reset();
		crsByKind = { 'acme.cert-manager.io/v1|Challenge': [{ metadata: { name: 'chal-1', namespace: 'kubwave', finalizers: ['x'] } }] };
		mergePatchError = Object.assign(new Error('forbidden'), { code: 403 });
		await drainDependencyCustomResources(mockKc, basePlan([CHALLENGE]));
		expect(mergePatchCalls).toHaveLength(0);
		expect(promptEvents.some(e => e.startsWith('warn:') && e.includes('chal-1'))).toBe(true);
		expect(promptEvents).toContain('stop:Cleared finalizers on 0 leftover resource(s); 1 could not be cleared (see warnings above)');
	});
});
