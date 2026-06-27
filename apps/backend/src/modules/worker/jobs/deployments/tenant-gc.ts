import { eq } from 'drizzle-orm';
import { AppsV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import { db, services } from '@kubwave/db';
import { LABEL_ENVIRONMENT_ID, LABEL_MANAGED_BY, LABEL_SERVICE_ID, MANAGED_BY_VALUE } from '@kubwave/kube';
import { deleteIgnoreMissing } from '../../../../shared/cluster/ops.js';
import { teardownNetworking } from '../../../../shared/cluster/networking.js';

// Reclaim orphaned cluster objects: emptied environment -> drop namespace; single service gone -> remove its workload. Only touches managed-by namespaces.
export async function gcOrphans(kc: KubeConfig): Promise<void> {
	const appsApi = kc.makeApiClient(AppsV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);
	const netApi = kc.makeApiClient(NetworkingV1Api);

	const namespaces = await coreApi.listNamespace({ labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}` });

	for (const ns of namespaces.items) {
		const namespace = ns.metadata?.name;
		const environmentId = ns.metadata?.labels?.[LABEL_ENVIRONMENT_ID];
		if (!namespace || !environmentId) continue;

		const liveServices = await db.select({ id: services.id }).from(services).where(eq(services.environmentId, environmentId));
		const live = new Set(liveServices.map(row => row.id));

		// No services -> drop the namespace (Background propagation GCs contents); re-created lazily if a service is added later.
		if (live.size === 0) {
			console.log(`[reconcile] GC: removing environment namespace ${namespace} (environment ${environmentId} has no services)`);
			await deleteIgnoreMissing(() => coreApi.deleteNamespace({ name: namespace, propagationPolicy: 'Background' }));
			continue;
		}

		// Otherwise reap workloads inside it whose service row is gone.
		const managed = await appsApi.listNamespacedDeployment({ namespace, labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}` });
		for (const dep of managed.items) {
			const serviceId = dep.metadata?.labels?.[LABEL_SERVICE_ID];
			const name = dep.metadata?.name;
			if (!serviceId || !name || live.has(serviceId)) continue;
			console.log(`[reconcile] GC: removing orphaned workload ${name} (service ${serviceId} no longer exists)`);
			await deleteIgnoreMissing(() => appsApi.deleteNamespacedDeployment({ name, namespace, propagationPolicy: 'Background' }));
			await teardownNetworking({ coreApi, netApi, namespace, serviceId });
		}
	}
}
