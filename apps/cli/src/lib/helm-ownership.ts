import { KubernetesObjectApi, type KubeConfig } from '@kubernetes/client-node';
import { execHelm } from '~/lib/helm-exec.js';
import { mergePatchWith, parseManifest } from '~/lib/k8s-apply.js';
import { KUBWAVE_PART_OF_LABEL, KUBWAVE_PART_OF_VALUE } from '~/lib/constants.js';

// Cluster-scoped kinds the dependency + CSI charts render; for these we omit namespace from the patch body
// (client-node resolves the path from discovery), while namespaced kinds default to the release namespace.
const CLUSTER_SCOPED_KINDS = new Set([
	'Namespace',
	'ClusterRole',
	'ClusterRoleBinding',
	'CustomResourceDefinition',
	'CSIDriver',
	'StorageClass',
	'PriorityClass',
	'RuntimeClass',
	'IngressClass',
	'ValidatingWebhookConfiguration',
	'MutatingWebhookConfiguration',
	'APIService'
]);

// Stamp the part-of audit anchor on a helm release's rendered objects. Only part-of: component/instance/managed-by
// are chart-owned and helm re-applies server-side, so claiming them here would conflict on the next install.
export async function stampHelmReleaseOwnership(kc: KubeConfig, release: string, namespace: string): Promise<void> {
	const { stdout, exitCode } = await execHelm(['get', 'manifest', release, '--namespace', namespace]);
	if (exitCode !== 0) return;

	const labels = { [KUBWAVE_PART_OF_LABEL]: KUBWAVE_PART_OF_VALUE };
	const api = KubernetesObjectApi.makeApiClient(kc);

	// Independent patches run concurrently; best-effort, a failed patch never fails the install.
	await Promise.all(
		parseManifest(stdout).map(async obj => {
			const name = obj.metadata?.name;
			if (!name || !obj.kind) return;
			const metadata: { name: string; namespace?: string; labels: Record<string, string> } = { name, labels };
			if (!CLUSTER_SCOPED_KINDS.has(obj.kind)) metadata.namespace = obj.metadata?.namespace ?? namespace;
			try {
				await mergePatchWith(api, { apiVersion: obj.apiVersion, kind: obj.kind, metadata });
			} catch {
				// best-effort
			}
		})
	);
}
