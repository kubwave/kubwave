import { CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import { APP_NAMESPACE, HELM_RELEASE_NAME } from '~/lib/constants.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';

export interface PreflightResult {
	ok: boolean;
	label: string;
	message: string;
}

export async function checkCluster(kc: KubeConfig): Promise<PreflightResult> {
	const api = kc.makeApiClient(CoreV1Api);
	try {
		await api.listNamespace({ timeoutSeconds: 5 });
		return { ok: true, label: 'Cluster', message: 'Cluster reachable' };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			label: 'Cluster',
			message: `Cluster not reachable: ${msg}. Check your KUBECONFIG and the current context.`
		};
	}
}

export async function checkHelmRelease(kc: KubeConfig): Promise<PreflightResult> {
	const api = kc.makeApiClient(CoreV1Api);
	try {
		const list = await api.listNamespacedSecret({
			namespace: APP_NAMESPACE,
			labelSelector: `owner=helm,name=${HELM_RELEASE_NAME}`
		});

		if (list.items.length > 0) {
			return {
				ok: true,
				label: 'Helm-Release',
				message: `Existing Helm release "${HELM_RELEASE_NAME}" found — will be updated via upgrade.`
			};
		}
		return { ok: true, label: 'Helm-Release', message: 'No existing release — fresh installation.' };
	} catch (err: unknown) {
		if (isNotFoundError(err)) {
			return { ok: true, label: 'Helm-Release', message: 'Namespace does not exist — fresh installation.' };
		}
		return {
			ok: false,
			label: 'Helm-Release',
			message: `Helm release check failed: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}

export async function runPreflightChecks(kc: KubeConfig): Promise<{ allPassed: boolean; results: PreflightResult[] }> {
	const results = await Promise.all([checkCluster(kc), checkHelmRelease(kc)]);
	const allPassed = results.every(r => r.ok);
	return { allPassed, results };
}
