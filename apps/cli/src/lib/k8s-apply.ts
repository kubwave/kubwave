import type { KubeConfig, KubernetesObject } from '@kubernetes/client-node';
import { KubernetesObjectApi, PatchStrategy } from '@kubernetes/client-node';
import { parseAllDocuments } from 'yaml';
import { isNotFoundError } from '~/lib/k8s-errors.js';

const FIELD_MANAGER = 'kubwave';

// Namespaces and CRDs must land before the namespaced/custom objects that depend on them.
function applyRank(obj: KubernetesObject): number {
	if (obj.kind === 'Namespace') return 0;
	if (obj.kind === 'CustomResourceDefinition') return 1;
	return 2;
}

// Split objects into rank-ordered buckets. Ranks run sequentially (Namespace → CRD → rest, reversed for
// delete); objects within a rank are independent and run concurrently.
function rankBuckets(objects: KubernetesObject[], order: 'asc' | 'desc'): KubernetesObject[][] {
	const ranks = [...new Set(objects.map(applyRank))].sort((a, b) => (order === 'asc' ? a - b : b - a));
	return ranks.map(rank => objects.filter(obj => applyRank(obj) === rank));
}

export function parseManifest(yamlText: string): KubernetesObject[] {
	const objects: KubernetesObject[] = [];
	for (const doc of parseAllDocuments(yamlText)) {
		const json = doc.toJSON() as KubernetesObject | null;
		if (json && json.kind && json.apiVersion) {
			objects.push(json);
		}
	}
	return objects;
}

export interface ApplyManifestOpts {
	// Merged into metadata.labels of every object — ownership tagging so teardown only removes what we applied.
	labels?: Record<string, string>;
	// Merged into the pod-template nodeSelector of every workload (Deployment/DaemonSet/StatefulSet/...).
	// A vendored CSI manifest only selects kubernetes.io/os; on a multi-provider cluster the driver must be
	// pinned to its provider's nodes or its node plugin schedules onto (and crashloops on) the wrong cloud's nodes.
	nodeSelector?: Record<string, string>;
}

function mergeLabels(obj: KubernetesObject, labels: Record<string, string>): void {
	obj.metadata ??= {};
	obj.metadata.labels = { ...obj.metadata.labels, ...labels };
}

function mergeNodeSelector(obj: KubernetesObject, nodeSelector: Record<string, string>): void {
	const podSpec = (obj as { spec?: { template?: { spec?: { nodeSelector?: Record<string, string> } } } }).spec?.template?.spec;
	if (!podSpec) return; // not a pod-templated workload (RBAC, CSIDriver, Namespace, ...) — nothing to pin
	podSpec.nodeSelector = { ...podSpec.nodeSelector, ...nodeSelector };
}

// Server-side merge-patch a single object (e.g. stamp an annotation/label onto an existing resource).
export async function mergePatch(kc: KubeConfig, obj: KubernetesObject): Promise<void> {
	const api = KubernetesObjectApi.makeApiClient(kc);
	await api.patch(obj, undefined, undefined, FIELD_MANAGER, undefined, PatchStrategy.MergePatch);
}

export async function applyManifest(kc: KubeConfig, yamlText: string, opts: ApplyManifestOpts = {}): Promise<number> {
	const api = KubernetesObjectApi.makeApiClient(kc);
	const objects = parseManifest(yamlText);
	for (const obj of objects) {
		if (opts.labels) mergeLabels(obj, opts.labels);
		if (opts.nodeSelector) mergeNodeSelector(obj, opts.nodeSelector);
	}
	for (const bucket of rankBuckets(objects, 'asc')) {
		await Promise.all(
			bucket.map(async obj => {
				try {
					await api.patch(obj, undefined, undefined, FIELD_MANAGER, true, PatchStrategy.ServerSideApply);
				} catch (err) {
					const name = obj.metadata?.name ?? '<unnamed>';
					const message = err instanceof Error ? err.message : String(err);
					throw new Error(`Failed to apply ${obj.kind}/${name}: ${message}`);
				}
			})
		);
	}
	return objects.length;
}

export async function deleteManifest(kc: KubeConfig, yamlText: string): Promise<number> {
	const api = KubernetesObjectApi.makeApiClient(kc);
	const objects = parseManifest(yamlText);
	for (const bucket of rankBuckets(objects, 'desc')) {
		await Promise.all(
			bucket.map(async obj => {
				try {
					await api.delete(obj);
				} catch (err) {
					if (!isNotFoundError(err)) throw err;
				}
			})
		);
	}
	return objects.length;
}
