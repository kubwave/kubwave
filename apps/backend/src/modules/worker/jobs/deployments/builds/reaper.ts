import { inArray } from 'drizzle-orm';
import { BatchV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import { db, deployments } from '@kubwave/db';
import { env } from '../../../../../shared/config/worker-env.js';
import { deleteIgnoreMissing } from '../../../../../shared/cluster/ops.js';
import { BUILDER_LABEL_SELECTOR, LABEL_DEPLOYMENT_ID } from './service.js';
import { BUILD_ACTIVE_STATUSES } from '../types.js';

// Reap build artifacts (Job, ConfigMap, SSH Secret, NetworkPolicy) whose deployment is no longer active - catches superseded/canceled
// builds and gone deployment rows beyond TTL, and bounds how long decrypted deploy keys live in the cluster.
export async function reapOrphanBuildJobs(kc: KubeConfig): Promise<void> {
	const namespace = env.podNamespace;
	const batchApi = kc.makeApiClient(BatchV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);
	const netApi = kc.makeApiClient(NetworkingV1Api);

	const [jobs, configMaps, secrets, policies] = await Promise.all([
		batchApi.listNamespacedJob({ namespace, labelSelector: BUILDER_LABEL_SELECTOR }),
		coreApi.listNamespacedConfigMap({ namespace, labelSelector: BUILDER_LABEL_SELECTOR }),
		coreApi.listNamespacedSecret({ namespace, labelSelector: BUILDER_LABEL_SELECTOR }),
		netApi.listNamespacedNetworkPolicy({ namespace, labelSelector: BUILDER_LABEL_SELECTOR })
	]);
	if (jobs.items.length === 0 && configMaps.items.length === 0 && secrets.items.length === 0 && policies.items.length === 0) return;

	const referenced = new Set<string>();
	for (const obj of [...jobs.items, ...configMaps.items, ...secrets.items, ...policies.items]) {
		const id = obj.metadata?.labels?.[LABEL_DEPLOYMENT_ID];
		if (id) referenced.add(id);
	}
	if (referenced.size === 0) return;

	const rows = await db
		.select({ id: deployments.id, status: deployments.status })
		.from(deployments)
		.where(inArray(deployments.id, [...referenced]));
	const active = new Set(rows.filter(r => (BUILD_ACTIVE_STATUSES as readonly string[]).includes(r.status)).map(r => r.id));
	// A referenced id absent from `rows` (deployment row deleted) is not active, so it falls through to deletion.

	let reaped = 0;
	for (const j of jobs.items) {
		const id = j.metadata?.labels?.[LABEL_DEPLOYMENT_ID];
		const name = j.metadata?.name;
		if (!id || !name || active.has(id)) continue;
		await deleteIgnoreMissing(() => batchApi.deleteNamespacedJob({ name, namespace, propagationPolicy: 'Background' }));
		reaped++;
	}
	for (const cm of configMaps.items) {
		const id = cm.metadata?.labels?.[LABEL_DEPLOYMENT_ID];
		const name = cm.metadata?.name;
		if (!id || !name || active.has(id)) continue;
		await deleteIgnoreMissing(() => coreApi.deleteNamespacedConfigMap({ name, namespace }));
		reaped++;
	}
	for (const s of secrets.items) {
		const id = s.metadata?.labels?.[LABEL_DEPLOYMENT_ID];
		const name = s.metadata?.name;
		if (!id || !name || active.has(id)) continue;
		await deleteIgnoreMissing(() => coreApi.deleteNamespacedSecret({ name, namespace }));
		reaped++;
	}
	for (const policy of policies.items) {
		const id = policy.metadata?.labels?.[LABEL_DEPLOYMENT_ID];
		const name = policy.metadata?.name;
		if (!id || !name || active.has(id)) continue;
		await deleteIgnoreMissing(() => netApi.deleteNamespacedNetworkPolicy({ name, namespace }));
		reaped++;
	}

	if (reaped > 0) console.log(`[reconcile] reaped ${reaped} orphan build artifact(s) in ${namespace}`);
}
