import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { KubernetesObjectApi, type KubeConfig } from '@kubernetes/client-node';

let execHelmArgs: string[] = [];
let manifest = '';
let exitCode = 0;

mock.module('~/lib/helm-exec.js', () => ({
	execHelm: async (args: string[]) => {
		execHelmArgs = args;
		return { stdout: manifest, stderr: '', exitCode };
	}
}));

const { stampHelmReleaseOwnership } = await import('../src/lib/helm-ownership.js');

interface PatchSpec {
	apiVersion: string;
	kind: string;
	metadata: { name: string; namespace?: string; labels: Record<string, string> };
}

const realMakeApiClient = KubernetesObjectApi.makeApiClient;
let patches: PatchSpec[] = [];

beforeEach(() => {
	execHelmArgs = [];
	exitCode = 0;
	patches = [];
	KubernetesObjectApi.makeApiClient = (() => ({
		patch: async (spec: PatchSpec) => {
			patches.push(spec);
			return spec;
		}
	})) as never;
});

afterEach(() => {
	KubernetesObjectApi.makeApiClient = realMakeApiClient;
});

const kc = {} as KubeConfig;
const MANIFEST = [
	'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: traefik\n  namespace: traefik',
	'apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata:\n  name: traefik-role',
	'apiVersion: v1\nkind: Service\nmetadata:\n  name: traefik-svc',
	'apiVersion: storage.k8s.io/v1\nkind: CSIDriver\nmetadata:\n  name: csi.hetzner.cloud'
].join('\n---\n');

describe('stampHelmReleaseOwnership', () => {
	test('patches every object with ONLY part-of (never chart-owned component/instance/managed-by)', async () => {
		manifest = MANIFEST;
		await stampHelmReleaseOwnership(kc, 'traefik', 'traefik');

		expect(execHelmArgs).toEqual(['get', 'manifest', 'traefik', '--namespace', 'traefik']);
		expect(patches).toHaveLength(4);
		for (const p of patches) {
			// Only part-of — claiming component/instance would conflict with the chart's server-side apply on re-install.
			expect(p.metadata.labels).toEqual({ 'app.kubernetes.io/part-of': 'kubwave' });
		}
	});

	test('sets namespace for namespaced kinds (defaulting to the release namespace) and omits it for cluster-scoped', async () => {
		manifest = MANIFEST;
		await stampHelmReleaseOwnership(kc, 'traefik', 'traefik');

		const byKind = Object.fromEntries(patches.map(p => [p.kind, p]));
		expect(byKind.Deployment!.metadata.namespace).toBe('traefik');
		expect(byKind.Service!.metadata.namespace).toBe('traefik'); // rendered without a namespace → release ns
		expect(byKind.ClusterRole!.metadata.namespace).toBeUndefined();
		expect(byKind.CSIDriver!.metadata.namespace).toBeUndefined();
	});

	test('does nothing when helm get manifest fails', async () => {
		manifest = '';
		exitCode = 1;
		await stampHelmReleaseOwnership(kc, 'traefik', 'traefik');
		expect(patches).toHaveLength(0);
	});
});
