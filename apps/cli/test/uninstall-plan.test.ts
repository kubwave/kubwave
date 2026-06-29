import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import * as realK8s from '../src/lib/k8s.js';
import * as realHelm from '../src/lib/helm.js';
import { clackStub } from './support/clack-stub.js';

mock.module('~/lib/k8s-apply.js', () => ({
	deleteManifest: async () => 0,
	applyManifest: async () => 0,
	parseManifest: () => []
}));

const helmUninstallCalls: Array<{ release: string; namespace: string }> = [];
const helmListCalls: string[] = [];
const apiCalls: string[] = [];
const promptEvents: string[] = [];
const cancelledPrompt = Symbol('cancelled');
let pvcMode: 'items' | 'namespace-missing' | 'empty' = 'items';
let confirmResult: boolean | symbol = true;
let stagingNamespaceExists = true;
let stagingReleaseNames: string[] = ['kubwave-staging'];
let envNamespaces: string[] = ['kubwave-env-aaa', 'kubwave-env-bbb'];
let clusterRoles: string[] = ['kubwave-updater-cert-manager', 'unrelated-role'];
let clusterRoleBindings: string[] = ['kubwave-updater-cert-manager'];
let crds: string[] = ['clusters.postgresql.cnpg.io', 'backups.postgresql.cnpg.io', 'widgets.example.com'];
const helmUninstallErrors = new Map<string, Error>();
const pvcDeleteErrors = new Map<string, Error>();
const secretDeleteErrors = new Map<string, Error>();
const namespaceDeleteErrors = new Map<string, Error>();
const namespaceNotFound = new Set<string>(['traefik']);
const clusterRoleDeleteErrors = new Map<string, Error>();
const clusterRoleBindingDeleteErrors = new Map<string, Error>();
const clusterRoleNotFound = new Set<string>();
const clusterRoleBindingNotFound = new Set<string>();
const crdDeleteErrors = new Map<string, Error>();
const crdNotFound = new Set<string>();

const api = {
	readNamespace: async ({ name }: { name: string }) => {
		apiCalls.push(`read-namespace:${name}`);
		if (name === 'kubwave-staging' && !stagingNamespaceExists) throw { code: 404 };
		// These plan tests never install the GCP CSI driver, so its namespace is always absent.
		if (name === 'gce-pd-csi-driver') throw { code: 404 };
		return { metadata: { name } };
	},
	listPersistentVolume: async () => {
		apiCalls.push('list-pvs');
		return { items: [] };
	},
	deleteStorageClass: async ({ name }: { name: string }) => {
		apiCalls.push(`delete-storageclass:${name}`);
	},
	listNamespacedPersistentVolumeClaim: async ({ namespace }: { namespace: string }) => {
		apiCalls.push(`list-pvcs:${namespace}`);
		if (pvcMode === 'namespace-missing') throw { code: 404 };
		if (pvcMode === 'empty') return { items: [] };
		// staging has its own postgres-data PVC; prod gets the original two.
		if (namespace === 'kubwave-staging') {
			return { items: [{ metadata: { name: 'postgres-data-staging' } }] };
		}
		return { items: [{ metadata: { name: 'postgres-data' } }, { metadata: {} }, { metadata: { name: 'already-gone' } }] };
	},
	deleteNamespacedPersistentVolumeClaim: async ({ name, namespace }: { name: string; namespace: string }) => {
		apiCalls.push(`delete-pvc:${namespace}/${name}`);
		if (name === 'already-gone') throw { code: 404 };
		const error = pvcDeleteErrors.get(name);
		if (error) throw error;
	},
	deleteNamespacedSecret: async ({ name }: { name: string }) => {
		apiCalls.push(`delete-secret:${name}`);
		if (name === 'letsencrypt-prod-account-key') throw { code: 404 };
		const error = secretDeleteErrors.get(name);
		if (error) throw error;
	},
	deleteNamespace: async ({ name }: { name: string }) => {
		apiCalls.push(`delete-namespace:${name}`);
		if (namespaceNotFound.has(name)) throw { code: 404 };
		const error = namespaceDeleteErrors.get(name);
		if (error) throw error;
	},
	listNamespace: async ({ labelSelector }: { labelSelector?: string } = {}) => {
		apiCalls.push(`list-namespaces:${labelSelector ?? ''}`);
		if (labelSelector === 'app.kubernetes.io/managed-by=kubwave-worker') {
			return { items: envNamespaces.map(name => ({ metadata: { name } })) };
		}
		return { items: [] };
	},
	listClusterRole: async () => {
		apiCalls.push('list-clusterroles');
		return { items: clusterRoles.map(name => ({ metadata: { name } })) };
	},
	listClusterRoleBinding: async () => {
		apiCalls.push('list-clusterrolebindings');
		return { items: clusterRoleBindings.map(name => ({ metadata: { name } })) };
	},
	deleteClusterRole: async ({ name }: { name: string }) => {
		apiCalls.push(`delete-clusterrole:${name}`);
		if (clusterRoleNotFound.has(name)) throw { code: 404 };
		const error = clusterRoleDeleteErrors.get(name);
		if (error) throw error;
	},
	deleteClusterRoleBinding: async ({ name }: { name: string }) => {
		apiCalls.push(`delete-clusterrolebinding:${name}`);
		if (clusterRoleBindingNotFound.has(name)) throw { code: 404 };
		const error = clusterRoleBindingDeleteErrors.get(name);
		if (error) throw error;
	},
	listCustomResourceDefinition: async () => {
		apiCalls.push('list-crds');
		return { items: crds.map(name => ({ metadata: { name } })) };
	},
	deleteCustomResourceDefinition: async ({ name }: { name: string }) => {
		apiCalls.push(`delete-crd:${name}`);
		if (crdNotFound.has(name)) throw { code: 404 };
		const error = crdDeleteErrors.get(name);
		if (error) throw error;
	}
};

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => confirmResult),
	isCancel: (value: unknown) => value === cancelledPrompt,
	intro: (message: string) => promptEvents.push(`intro:${message}`),
	outro: (message: string) => promptEvents.push(`outro:${message}`),
	log: {
		...clackStub().log,
		info: (message: string) => promptEvents.push(`info:${message}`),
		warn: (message: string) => promptEvents.push(`warn:${message}`),
		success: (message: string) => promptEvents.push(`success:${message}`),
		step: (message: string) => promptEvents.push(`step:${message}`)
	},
	spinner: () => ({
		start: (message: string) => promptEvents.push(`start:${message}`),
		stop: (message: string) => promptEvents.push(`stop:${message}`)
	})
}));

mock.module('~/lib/k8s.js', () => ({
	...realK8s,
	loadKubeConfig: () =>
		({
			makeApiClient: () => api
		}) as unknown as KubeConfig,
	getClusterInfo: () => ({ server: 'https://cluster.example', context: 'test-context' })
}));

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	helmUninstall: async (release: string, namespace: string) => {
		helmUninstallCalls.push({ release, namespace });
		const error = helmUninstallErrors.get(release);
		if (error) throw error;
		return { removed: release !== 'cert-manager' };
	},
	listReleaseNames: async (namespace: string) => {
		helmListCalls.push(namespace);
		// Default + override staging namespaces read from the same bucket so tests can probe either.
		if (namespace === 'kubwave-staging' || namespace === 'my-staging') {
			return [...stagingReleaseNames];
		}
		return [];
	}
}));

const { buildUninstallPlan, registerUninstallCommand, runUninstall } = await import('../src/commands/uninstall.js');

const mockKc = { makeApiClient: () => api } as unknown as KubeConfig;

function resetFixtures(): void {
	helmUninstallCalls.length = 0;
	helmListCalls.length = 0;
	apiCalls.length = 0;
	promptEvents.length = 0;
	pvcMode = 'items';
	confirmResult = true;
	stagingNamespaceExists = true;
	stagingReleaseNames = ['kubwave-staging'];
	envNamespaces = ['kubwave-env-aaa', 'kubwave-env-bbb'];
	clusterRoles = ['kubwave-updater-cert-manager', 'unrelated-role'];
	clusterRoleBindings = ['kubwave-updater-cert-manager'];
	crds = ['clusters.postgresql.cnpg.io', 'backups.postgresql.cnpg.io', 'widgets.example.com'];
	helmUninstallErrors.clear();
	pvcDeleteErrors.clear();
	secretDeleteErrors.clear();
	namespaceDeleteErrors.clear();
	namespaceNotFound.clear();
	namespaceNotFound.add('traefik');
	clusterRoleDeleteErrors.clear();
	clusterRoleBindingDeleteErrors.clear();
	clusterRoleNotFound.clear();
	clusterRoleBindingNotFound.clear();
	crdDeleteErrors.clear();
	crdNotFound.clear();
}

describe('uninstall plan', () => {
	test('registers and invokes the uninstall command action handler', async () => {
		resetFixtures();
		let capturedAction: ((opts: { yes: boolean; inCluster: boolean; keepStaging: boolean; stagingNamespace: string }) => Promise<void>) | undefined;
		const command = {
			description() {
				return this;
			},
			option() {
				return this;
			},
			action(fn: (opts: { yes: boolean; inCluster: boolean; keepStaging: boolean; stagingNamespace: string }) => Promise<void>) {
				capturedAction = fn;
				return this;
			}
		};
		const parent = {
			command(name: string) {
				expect(name).toBe('uninstall');
				return command;
			}
		};

		registerUninstallCommand(parent as never);
		expect(capturedAction).toBeDefined();

		await capturedAction!({ yes: true, inCluster: false, keepStaging: true, stagingNamespace: 'kubwave-staging' });

		expect(helmUninstallCalls.find(call => call.release === 'kubwave')).toBeDefined();
	});

	test('detects staging release and includes it in the plan', async () => {
		resetFixtures();
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.appRelease).toEqual({ release: 'kubwave', namespace: 'kubwave' });
		expect(plan.deletePvcs).toBe(true);
		expect(plan.stagingRelease).toEqual({ release: 'kubwave-staging', namespace: 'kubwave-staging' });
		expect(plan.stagingNamespace).toBe('kubwave-staging');
		expect(plan.stagingNamespaceExists).toBe(true);
		expect(plan.dependencyReleases).toEqual([
			{ release: 'traefik', namespace: 'traefik' },
			{ release: 'cert-manager', namespace: 'cert-manager' },
			{ release: 'cnpg', namespace: 'cnpg-system' }
		]);
		expect(plan.namespacesToDelete).toEqual(['kubwave', 'traefik', 'cert-manager', 'cnpg-system', 'kubwave-staging']);
		expect(plan.acmeAccountSecrets.map(secret => secret.name)).toEqual(['letsencrypt-prod-account-key', 'letsencrypt-staging-account-key']);
	});

	test('still includes the staging namespace when it exists without a helm release', async () => {
		resetFixtures();
		stagingReleaseNames = [];
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.stagingRelease).toBeNull();
		expect(plan.stagingNamespaceExists).toBe(true);
		expect(plan.namespacesToDelete).toContain('kubwave-staging');
	});

	test('omits staging entirely when the namespace does not exist', async () => {
		resetFixtures();
		stagingNamespaceExists = false;
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.stagingRelease).toBeNull();
		expect(plan.stagingNamespaceExists).toBe(false);
		expect(plan.namespacesToDelete).toEqual(['kubwave', 'traefik', 'cert-manager', 'cnpg-system']);
	});

	test('--keep-staging skips detection even when the namespace exists', async () => {
		resetFixtures();
		const plan = await buildUninstallPlan({ kc: mockKc, keepStaging: true });
		expect(plan.stagingRelease).toBeNull();
		expect(plan.stagingNamespaceExists).toBe(false);
		expect(plan.namespacesToDelete).toEqual(['kubwave', 'traefik', 'cert-manager', 'cnpg-system']);
		// Staging detection should be skipped — staging namespace must not be probed.
		expect(apiCalls.find(call => call.startsWith('read-namespace:kubwave-staging'))).toBeUndefined();
		expect(helmListCalls).not.toContain('kubwave-staging');
	});

	test('probes the override --staging-namespace', async () => {
		resetFixtures();
		stagingReleaseNames = ['my-test-release'];
		const plan = await buildUninstallPlan({ kc: mockKc, stagingNamespace: 'my-staging' });
		expect(plan.stagingRelease).toEqual({ release: 'my-test-release', namespace: 'my-staging' });
		expect(plan.stagingNamespace).toBe('my-staging');
		expect(plan.namespacesToDelete).toContain('my-staging');
		expect(helmListCalls).toContain('my-staging');
	});

	test('runs the uninstall plan with Kubernetes and Helm operations including staging', async () => {
		resetFixtures();

		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });

		expect(helmUninstallCalls).toEqual([
			{ release: 'kubwave', namespace: 'kubwave' },
			{ release: 'kubwave-staging', namespace: 'kubwave-staging' },
			{ release: 'traefik', namespace: 'traefik' },
			{ release: 'cert-manager', namespace: 'cert-manager' },
			{ release: 'cnpg', namespace: 'cnpg-system' }
		]);
		// PVCs cleaned in both prod and staging namespaces
		expect(apiCalls).toContain('delete-pvc:kubwave/postgres-data');
		expect(apiCalls).toContain('delete-pvc:kubwave/already-gone');
		expect(apiCalls).toContain('delete-pvc:kubwave-staging/postgres-data-staging');
		expect(apiCalls).toContain('delete-secret:letsencrypt-prod-account-key');
		expect(apiCalls).toContain('delete-secret:letsencrypt-staging-account-key');
		expect(apiCalls).toContain('delete-namespace:kubwave');
		expect(apiCalls).toContain('delete-namespace:traefik');
		expect(apiCalls).toContain('delete-namespace:cert-manager');
		expect(apiCalls).toContain('delete-namespace:cnpg-system');
		expect(apiCalls).toContain('delete-namespace:kubwave-staging');
	});

	test('aborts before cleanup when confirmation is declined', async () => {
		resetFixtures();
		confirmResult = false;

		await expect(runUninstall({ yes: false, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'Uninstall aborted.'
		);

		expect(helmUninstallCalls).toEqual([]);
		expect(apiCalls.find(call => call.startsWith('delete-'))).toBeUndefined();
	});

	test('aborts before cleanup when confirmation is cancelled', async () => {
		resetFixtures();
		confirmResult = cancelledPrompt;

		await expect(runUninstall({ yes: false, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'Uninstall aborted.'
		);

		expect(helmUninstallCalls).toEqual([]);
		expect(apiCalls.find(call => call.startsWith('delete-'))).toBeUndefined();
	});

	test('runs when a staging namespace exists without a release', async () => {
		resetFixtures();
		stagingReleaseNames = [];

		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });

		expect(promptEvents).toContain('info:Staging namespace "kubwave-staging" exists with no helm release — will be deleted.');
		expect(apiCalls).toContain('delete-namespace:kubwave-staging');
		expect(helmUninstallCalls.find(call => call.release === 'kubwave-staging')).toBeUndefined();
	});

	test('reports when no staging namespace is present', async () => {
		resetFixtures();
		stagingNamespaceExists = false;

		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });

		expect(promptEvents).toContain('info:No staging namespace "kubwave-staging" on the cluster — nothing to clean up there.');
		expect(apiCalls).not.toContain('delete-namespace:kubwave-staging');
	});

	test('propagates helm uninstall failures before deleting data', async () => {
		resetFixtures();
		helmUninstallErrors.set('kubwave', new Error('helm forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'helm forbidden'
		);

		expect(promptEvents).toContain('stop:helm uninstall failed');
		expect(apiCalls.find(call => call.startsWith('delete-pvc'))).toBeUndefined();
	});

	test('propagates staging helm uninstall failures', async () => {
		resetFixtures();
		helmUninstallErrors.set('kubwave-staging', new Error('staging helm forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'staging helm forbidden'
		);

		expect(promptEvents).toContain('stop:helm uninstall (staging) failed');
	});

	test('--keep-staging skips the staging release + namespace even if they exist', async () => {
		resetFixtures();
		await runUninstall({ yes: true, inCluster: false, keepStaging: true, stagingNamespace: 'kubwave-staging' });
		expect(helmUninstallCalls.find(c => c.release === 'kubwave-staging')).toBeUndefined();
		expect(apiCalls.find(c => c.startsWith('delete-namespace:kubwave-staging'))).toBeUndefined();
		expect(apiCalls.find(c => c.startsWith('delete-pvc:kubwave-staging'))).toBeUndefined();
		// Prod is still cleaned
		expect(helmUninstallCalls.find(c => c.release === 'kubwave')).toBeDefined();
		expect(apiCalls).toContain('delete-namespace:kubwave');
	});

	test('discovers worker-provisioned environment namespaces', async () => {
		resetFixtures();
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.environmentNamespaces).toEqual(['kubwave-env-aaa', 'kubwave-env-bbb']);
		// Kept separate from the chart/dependency namespaces.
		expect(plan.namespacesToDelete).not.toContain('kubwave-env-aaa');
		expect(apiCalls).toContain('list-namespaces:app.kubernetes.io/managed-by=kubwave-worker');
	});

	test('discovers orphaned cluster-scoped RBAC by name prefix, ignoring unrelated roles', async () => {
		resetFixtures();
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.clusterRoles).toEqual(['kubwave-updater-cert-manager']);
		expect(plan.clusterRoleBindings).toEqual(['kubwave-updater-cert-manager']);
		expect(plan.clusterRoles).not.toContain('unrelated-role');
	});

	test('deletes environment namespaces and orphan cluster RBAC during a run', async () => {
		resetFixtures();
		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });
		expect(apiCalls).toContain('delete-namespace:kubwave-env-aaa');
		expect(apiCalls).toContain('delete-namespace:kubwave-env-bbb');
		// Binding is removed before the role it references.
		const bindingIdx = apiCalls.indexOf('delete-clusterrolebinding:kubwave-updater-cert-manager');
		const roleIdx = apiCalls.indexOf('delete-clusterrole:kubwave-updater-cert-manager');
		expect(bindingIdx).toBeGreaterThanOrEqual(0);
		expect(roleIdx).toBeGreaterThanOrEqual(0);
		expect(bindingIdx).toBeLessThan(roleIdx);
		expect(apiCalls).not.toContain('delete-clusterrole:unrelated-role');
	});

	test('handles a cluster with no env namespaces or orphan RBAC', async () => {
		resetFixtures();
		envNamespaces = [];
		clusterRoles = ['unrelated-role'];
		clusterRoleBindings = [];
		crds = ['widgets.example.com'];
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.environmentNamespaces).toEqual([]);
		expect(plan.clusterRoles).toEqual([]);
		expect(plan.customResourceDefinitions).toEqual([]);
		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });
		expect(apiCalls.find(c => c.startsWith('delete-namespace:kubwave-env'))).toBeUndefined();
		expect(apiCalls.find(c => c.startsWith('delete-clusterrole'))).toBeUndefined();
		expect(apiCalls.find(c => c.startsWith('delete-crd'))).toBeUndefined();
	});

	test('discovers and deletes CloudNativePG CRDs while leaving unrelated CRDs alone', async () => {
		resetFixtures();
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.customResourceDefinitions).toEqual(['clusters.postgresql.cnpg.io', 'backups.postgresql.cnpg.io']);
		expect(plan.customResourceDefinitions).not.toContain('widgets.example.com');

		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });
		// The cnpg operator is helm-uninstalled, then its kept CRDs are swept.
		expect(helmUninstallCalls.find(c => c.release === 'cnpg')).toEqual({ release: 'cnpg', namespace: 'cnpg-system' });
		expect(apiCalls).toContain('delete-crd:clusters.postgresql.cnpg.io');
		expect(apiCalls).toContain('delete-crd:backups.postgresql.cnpg.io');
		expect(apiCalls).not.toContain('delete-crd:widgets.example.com');
	});

	test('skips PVC deletion when the namespace is already gone or no PVCs exist', async () => {
		resetFixtures();
		pvcMode = 'namespace-missing';

		await runUninstall({ yes: true, inCluster: true, keepStaging: false, stagingNamespace: 'kubwave-staging' });
		expect(apiCalls).not.toContain('delete-pvc:kubwave/postgres-data');

		apiCalls.length = 0;
		pvcMode = 'empty';

		await runUninstall({ yes: true, inCluster: true, keepStaging: false, stagingNamespace: 'kubwave-staging' });
		expect(apiCalls).not.toContain('delete-pvc:kubwave/postgres-data');
	});

	test('propagates non-not-found PVC deletion errors', async () => {
		resetFixtures();
		pvcDeleteErrors.set('postgres-data', new Error('pvc forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'pvc forbidden'
		);

		expect(promptEvents).toContain('stop:PVC deletion failed');
	});

	test('propagates dependency release uninstall errors', async () => {
		resetFixtures();
		pvcMode = 'empty';
		helmUninstallErrors.set('traefik', new Error('traefik helm forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'traefik helm forbidden'
		);

		expect(promptEvents).toContain('stop:helm uninstall traefik failed');
	});

	test('propagates ACME key deletion errors', async () => {
		resetFixtures();
		pvcMode = 'empty';
		secretDeleteErrors.set('letsencrypt-staging-account-key', new Error('secret forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'secret forbidden'
		);

		expect(promptEvents).toContain('stop:ACME key deletion failed');
	});

	test('propagates namespace deletion errors', async () => {
		resetFixtures();
		pvcMode = 'empty';
		namespaceDeleteErrors.set('kubwave', new Error('namespace forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'namespace forbidden'
		);

		expect(promptEvents).toContain('stop:Namespace "kubwave" deletion failed');
	});

	test('skips not-found environment namespaces, cluster RBAC, and CRDs during cleanup', async () => {
		resetFixtures();
		pvcMode = 'empty';
		namespaceNotFound.add('kubwave-env-aaa');
		clusterRoleBindingNotFound.add('kubwave-updater-cert-manager');
		clusterRoleNotFound.add('kubwave-updater-cert-manager');
		crdNotFound.add('clusters.postgresql.cnpg.io');

		await runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' });

		expect(promptEvents).toContain('stop:Environment namespace "kubwave-env-aaa" not found — skipped');
		expect(promptEvents).toContain('step:ClusterRoleBinding "kubwave-updater-cert-manager" not found — skipped');
		expect(promptEvents).toContain('step:ClusterRole "kubwave-updater-cert-manager" not found — skipped');
		expect(promptEvents).toContain('step:CRD "clusters.postgresql.cnpg.io" not found — skipped');
	});

	test('propagates environment namespace deletion errors', async () => {
		resetFixtures();
		pvcMode = 'empty';
		namespaceDeleteErrors.set('kubwave-env-aaa', new Error('env namespace forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'env namespace forbidden'
		);

		expect(promptEvents).toContain('stop:Environment namespace "kubwave-env-aaa" deletion failed');
	});

	test('propagates cluster RBAC deletion errors', async () => {
		resetFixtures();
		pvcMode = 'empty';
		clusterRoleBindingDeleteErrors.set('kubwave-updater-cert-manager', new Error('rbac forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'rbac forbidden'
		);

		expect(promptEvents).toContain('stop:Cluster RBAC deletion failed');
	});

	test('propagates cluster role deletion errors after bindings are removed', async () => {
		resetFixtures();
		pvcMode = 'empty';
		clusterRoleDeleteErrors.set('kubwave-updater-cert-manager', new Error('role forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'role forbidden'
		);

		expect(apiCalls).toContain('delete-clusterrolebinding:kubwave-updater-cert-manager');
		expect(promptEvents).toContain('stop:Cluster RBAC deletion failed');
	});

	test('propagates CRD deletion errors', async () => {
		resetFixtures();
		pvcMode = 'empty';
		clusterRoles = [];
		clusterRoleBindings = [];
		crdDeleteErrors.set('clusters.postgresql.cnpg.io', new Error('crd forbidden'));

		await expect(runUninstall({ yes: true, inCluster: false, keepStaging: false, stagingNamespace: 'kubwave-staging' })).rejects.toThrow(
			'crd forbidden'
		);

		expect(promptEvents).toContain('stop:CRD deletion failed');
	});
});
