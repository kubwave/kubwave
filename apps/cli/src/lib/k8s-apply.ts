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

export async function applyManifest(kc: KubeConfig, yamlText: string): Promise<number> {
	const api = KubernetesObjectApi.makeApiClient(kc);
	const objects = parseManifest(yamlText).sort((a, b) => applyRank(a) - applyRank(b));
	for (const obj of objects) {
		try {
			await api.patch(obj, undefined, undefined, FIELD_MANAGER, true, PatchStrategy.ServerSideApply);
		} catch (err) {
			const name = obj.metadata?.name ?? '<unnamed>';
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to apply ${obj.kind}/${name}: ${message}`);
		}
	}
	return objects.length;
}

export async function deleteManifest(kc: KubeConfig, yamlText: string): Promise<number> {
	const api = KubernetesObjectApi.makeApiClient(kc);
	const objects = parseManifest(yamlText).sort((a, b) => applyRank(b) - applyRank(a));
	for (const obj of objects) {
		try {
			await api.delete(obj);
		} catch (err) {
			if (!isNotFoundError(err)) throw err;
		}
	}
	return objects.length;
}
