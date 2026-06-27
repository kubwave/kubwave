import { CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import { APP_NAMESPACE } from '~/lib/constants.js';
import { FatalCliError, UserCancelledError } from '~/lib/errors.js';

export interface AdoptionResult {
	hasOrphans: boolean;
	reuseData: boolean;
}

export async function checkAdoption(kc: KubeConfig): Promise<AdoptionResult> {
	const api = kc.makeApiClient(CoreV1Api);

	try {
		await api.readNamespace({ name: APP_NAMESPACE });
	} catch {
		return { hasOrphans: false, reuseData: false };
	}

	try {
		const pvcs = await api.listNamespacedPersistentVolumeClaim({
			namespace: APP_NAMESPACE,
			labelSelector: 'app.kubernetes.io/part-of=kubwave'
		});

		const secrets = await api.listNamespacedSecret({
			namespace: APP_NAMESPACE,
			labelSelector: 'owner=helm,name=kubwave'
		});

		const hasHelmRelease = secrets.items.length > 0;
		const hasOrphanedData = pvcs.items.length > 0 && !hasHelmRelease;

		if (!hasOrphanedData) {
			return { hasOrphans: false, reuseData: false };
		}

		p.log.warn('Existing data from a previous installation found (PVC without Helm release).');
		const reuse = await p.confirm({
			message: 'Reuse existing Postgres data?',
			initialValue: true
		});

		if (p.isCancel(reuse)) {
			throw new UserCancelledError('Installation aborted.');
		}

		if (!reuse) {
			throw new FatalCliError('Installation aborted. Remove the existing resources manually and try again.');
		}

		return { hasOrphans: true, reuseData: true };
	} catch {
		return { hasOrphans: false, reuseData: false };
	}
}
