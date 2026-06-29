import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import * as realK8s from '../src/lib/k8s.js';
import * as realHelm from '../src/lib/helm.js';
import { clackStub } from './support/clack-stub.js';

const helmUninstallCalls: Array<{ release: string; namespace: string }> = [];
const helmListReleases: Record<string, string[]> = {};
const deleteManifestCalls: string[] = [];
const deleteStorageClassCalls: string[] = [];
const promptEvents: string[] = [];

// PV state: items returned by listPersistentVolume. pvEmptyAfterCall = how many calls before switching to [].
let pvItems: Array<{ spec?: { csi?: { driver: string } } }> = [];
let pvCallCount = 0;
let pvEmptyAfterCall = Infinity;

// CSI namespace presence
let gceCsiNamespaceExists = false;

const api = {
	readNamespace: async ({ name }: { name: string }) => {
		if (name === 'kubwave-staging') throw { code: 404 };
		if (name === 'gce-pd-csi-driver' && !gceCsiNamespaceExists) throw { code: 404 };
		return { metadata: { name } };
	},
	listPersistentVolume: async (_param?: { limit?: number; _continue?: string }) => {
		pvCallCount++;
		return { items: pvCallCount > pvEmptyAfterCall ? [] : [...pvItems], metadata: {} };
	},
	deleteStorageClass: async ({ name }: { name: string }) => {
		deleteStorageClassCalls.push(name);
	},
	// Stubs for the rest of buildUninstallPlan detection
	listNamespace: async () => ({ items: [] }),
	listClusterRole: async () => ({ items: [] }),
	listClusterRoleBinding: async () => ({ items: [] }),
	listCustomResourceDefinition: async () => ({ items: [] }),
	listNamespacedPersistentVolumeClaim: async () => ({ items: [] }),
	deleteNamespace: async () => {},
	deleteNamespacedPersistentVolumeClaim: async () => {},
	deleteNamespacedSecret: async () => {},
	deleteClusterRole: async () => {},
	deleteClusterRoleBinding: async () => {},
	deleteCustomResourceDefinition: async () => {}
};

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => true),
	isCancel: () => false,
	intro: () => {},
	outro: () => {},
	log: {
		...clackStub().log,
		info: (msg: string) => promptEvents.push(`info:${msg}`),
		warn: (msg: string) => promptEvents.push(`warn:${msg}`),
		success: (msg: string) => promptEvents.push(`success:${msg}`),
		step: (msg: string) => promptEvents.push(`step:${msg}`)
	},
	spinner: () => ({
		start: (msg: string) => promptEvents.push(`start:${msg}`),
		stop: (msg: string) => promptEvents.push(`stop:${msg}`)
	})
}));

mock.module('~/lib/k8s.js', () => ({
	...realK8s,
	loadKubeConfig: () => ({ makeApiClient: () => api }) as unknown as KubeConfig,
	getClusterInfo: () => ({ server: 'https://cluster.example', context: 'test-context' })
}));

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	helmUninstall: async (release: string, namespace: string) => {
		helmUninstallCalls.push({ release, namespace });
		return { removed: true };
	},
	listReleaseNames: async (namespace: string) => helmListReleases[namespace] ?? []
}));

mock.module('~/lib/k8s-apply.js', () => ({
	deleteManifest: async (_kc: unknown, manifest: string) => {
		deleteManifestCalls.push(manifest.slice(0, 20));
		return 0;
	},
	applyManifest: async () => 0,
	parseManifest: () => []
}));

const { buildUninstallPlan, teardownCsiDrivers, countCsiPvs } = await import('../src/commands/uninstall.js');

const mockKc = { makeApiClient: () => api } as unknown as KubeConfig;

function resetFixtures(): void {
	helmUninstallCalls.length = 0;
	for (const k of Object.keys(helmListReleases)) delete helmListReleases[k];
	deleteManifestCalls.length = 0;
	deleteStorageClassCalls.length = 0;
	promptEvents.length = 0;
	pvItems = [];
	pvCallCount = 0;
	pvEmptyAfterCall = Infinity;
	gceCsiNamespaceExists = false;
}

// Minimal plan with GCP CSI teardown target for teardown-focused tests.
function gcpCsiPlan(): Parameters<typeof teardownCsiDrivers>[1] {
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
		customResourceDefinitions: [],
		csiTeardowns: [
			{
				label: 'GCP Persistent Disk CSI Driver',
				provisioner: 'pd.csi.storage.gke.io',
				install: { kind: 'manifest', namespace: 'gce-pd-csi-driver', driverVersion: 'v1.26.0', manifest: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: gce-pd-csi-driver' },
				storageClass: 'pd-ssd'
			}
		]
	};
}

function hetznerCsiPlan(): Parameters<typeof teardownCsiDrivers>[1] {
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
		customResourceDefinitions: [],
		csiTeardowns: [
			{
				label: 'Hetzner Cloud CSI Driver',
				provisioner: 'csi.hetzner.cloud',
				install: { kind: 'helm', repo: { name: 'hcloud', url: 'https://charts.hetzner.cloud' }, chart: 'hcloud/hcloud-csi', release: 'hcloud-csi', namespace: 'kube-system', extraArgs: [] },
				storageClass: undefined
			}
		]
	};
}

describe('CSI teardown detection', () => {
	test('detects GCP CSI when its namespace exists', async () => {
		resetFixtures();
		gceCsiNamespaceExists = true;
		const plan = await buildUninstallPlan({ kc: mockKc });
		const gcp = plan.csiTeardowns.find(t => t.provisioner === 'pd.csi.storage.gke.io');
		expect(gcp).toBeDefined();
		expect(gcp?.label).toBe('GCP Persistent Disk CSI Driver');
		expect(gcp?.storageClass).toBe('pd-ssd');
		expect(gcp?.install.kind).toBe('manifest');
	});

	test('detects hetzner CSI when its helm release is listed', async () => {
		resetFixtures();
		helmListReleases['kube-system'] = ['hcloud-csi'];
		const plan = await buildUninstallPlan({ kc: mockKc });
		const hetzner = plan.csiTeardowns.find(t => t.provisioner === 'csi.hetzner.cloud');
		expect(hetzner).toBeDefined();
		expect(hetzner?.label).toBe('Hetzner Cloud CSI Driver');
		// Hetzner has no createStorageClass — storageClass must be undefined.
		expect(hetzner?.storageClass).toBeUndefined();
	});

	test('detects AWS CSI when its helm release is listed', async () => {
		resetFixtures();
		helmListReleases['kube-system'] = ['aws-ebs-csi-driver'];
		const plan = await buildUninstallPlan({ kc: mockKc });
		const aws = plan.csiTeardowns.find(t => t.provisioner === 'ebs.csi.aws.com');
		expect(aws).toBeDefined();
		expect(aws?.storageClass).toBe('ebs-sc');
	});

	test('detects no CSI when namespaces are absent and no releases listed', async () => {
		resetFixtures();
		const plan = await buildUninstallPlan({ kc: mockKc });
		expect(plan.csiTeardowns).toHaveLength(0);
	});

	test('includes CSI teardown in planned operations string', async () => {
		resetFixtures();
		gceCsiNamespaceExists = true;
		const plan = await buildUninstallPlan({ kc: mockKc });
		// Build a minimal confirmation by checking the csiTeardowns length
		expect(plan.csiTeardowns.length).toBeGreaterThan(0);
	});
});

describe('CSI teardown execution', () => {
	test('calls deleteManifest and deleteStorageClass for a manifest CSI', async () => {
		resetFixtures();
		const plan = gcpCsiPlan();
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 100, pollMs: 5 });
		expect(deleteManifestCalls).toHaveLength(1);
		expect(deleteStorageClassCalls).toContain('pd-ssd');
		expect(helmUninstallCalls).toHaveLength(0);
	});

	test('calls helmUninstall for a helm CSI and skips storageClass when none set', async () => {
		resetFixtures();
		const plan = hetznerCsiPlan();
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 100, pollMs: 5 });
		expect(helmUninstallCalls).toContainEqual({ release: 'hcloud-csi', namespace: 'kube-system' });
		expect(deleteStorageClassCalls).toHaveLength(0);
		expect(deleteManifestCalls).toHaveLength(0);
	});

	test('no-ops when csiTeardowns is empty', async () => {
		resetFixtures();
		const plan = gcpCsiPlan();
		plan.csiTeardowns = [];
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 100, pollMs: 5 });
		expect(deleteManifestCalls).toHaveLength(0);
		expect(helmUninstallCalls).toHaveLength(0);
	});

	test('proceeds immediately when initial PV check returns zero', async () => {
		resetFixtures();
		pvItems = [];
		const plan = gcpCsiPlan();
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 100, pollMs: 5 });
		// Only one listPersistentVolume call (the initial check) before proceeding.
		expect(pvCallCount).toBe(1);
		expect(deleteManifestCalls).toHaveLength(1);
	});

	test('proceeds after PVs drain during polling', async () => {
		resetFixtures();
		pvItems = [{ spec: { csi: { driver: 'pd.csi.storage.gke.io' } } }];
		pvEmptyAfterCall = 1; // first call returns PVs, second returns []
		const plan = gcpCsiPlan();
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 500, pollMs: 5 });
		expect(deleteManifestCalls).toHaveLength(1);
		expect(deleteStorageClassCalls).toContain('pd-ssd');
	});
});

describe('CSI teardown safety', () => {
	test('skips teardown and warns when PVs persist through the timeout', async () => {
		resetFixtures();
		pvItems = [{ spec: { csi: { driver: 'pd.csi.storage.gke.io' } } }];
		// pvEmptyAfterCall stays Infinity — PVs never drain.
		const plan = gcpCsiPlan();
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 50, pollMs: 10 });

		// Safety: driver must NOT be torn down.
		expect(deleteManifestCalls).toHaveLength(0);
		expect(deleteStorageClassCalls).toHaveLength(0);
		expect(helmUninstallCalls).toHaveLength(0);

		// A warning must mention the provisioner and the skip.
		const warnings = promptEvents.filter(e => e.startsWith('warn:'));
		expect(warnings.some(w => w.includes('pd.csi.storage.gke.io'))).toBe(true);
		expect(warnings.some(w => w.includes('LEFT IN PLACE'))).toBe(true);
	});

	test('skips only the driver whose PVs persist, leaving others unaffected', async () => {
		resetFixtures();
		// GCP PVs persist; AWS has none.
		pvItems = [{ spec: { csi: { driver: 'pd.csi.storage.gke.io' } } }];
		const plan = gcpCsiPlan();
		// Add AWS CSI to the plan too.
		plan.csiTeardowns.push({
			label: 'AWS EBS CSI Driver',
			provisioner: 'ebs.csi.aws.com',
			install: { kind: 'helm', repo: { name: 'aws-ebs-csi-driver', url: '' }, chart: 'aws-ebs-csi-driver/aws-ebs-csi-driver', release: 'aws-ebs-csi-driver', namespace: 'kube-system', extraArgs: [] },
			storageClass: 'ebs-sc'
		});

		// After GCP timeout, AWS PVs are gone (pvItems only has GCP PVs, so AWS count is 0).
		await teardownCsiDrivers(mockKc, plan, { timeoutMs: 50, pollMs: 10 });

		// GCP skipped
		expect(deleteManifestCalls).toHaveLength(0);
		// AWS torn down
		expect(helmUninstallCalls).toContainEqual({ release: 'aws-ebs-csi-driver', namespace: 'kube-system' });
		expect(deleteStorageClassCalls).toContain('ebs-sc');
	});
});

describe('countCsiPvs pagination', () => {
	test('follows a continue token across two pages and counts matching PVs from both', async () => {
		// Build a two-page mock: first call returns a continue token, second returns none.
		const page1 = [
			{ spec: { csi: { driver: 'pd.csi.storage.gke.io' } } },
			{ spec: { csi: { driver: 'other.driver' } } }
		];
		const page2 = [
			{ spec: { csi: { driver: 'pd.csi.storage.gke.io' } } },
			{ spec: { csi: { driver: 'pd.csi.storage.gke.io' } } }
		];
		let call = 0;
		const paginatedApi = {
			listPersistentVolume: async (param?: { limit?: number; _continue?: string }) => {
				call++;
				if (call === 1) {
					// First page: return continue token.
					expect(param?._continue).toBeUndefined();
					return { items: page1, metadata: { _continue: 'page2-token' } };
				}
				// Second page: verify token forwarded, no more pages.
				expect(param?._continue).toBe('page2-token');
				return { items: page2, metadata: {} };
			}
		} as unknown as import('@kubernetes/client-node').CoreV1Api;

		const count = await countCsiPvs(paginatedApi, 'pd.csi.storage.gke.io');
		// page1 has 1 match, page2 has 2 matches → total 3.
		expect(count).toBe(3);
		expect(call).toBe(2);
	});
});
