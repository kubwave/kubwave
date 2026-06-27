import { CoreV1Api, CustomObjectsApi, StorageV1Api, type V1PersistentVolumeClaim } from '@kubernetes/client-node';
import { CNPG_DATA_PVC, CNPG_POD_SELECTOR, parseMemoryToBytes, type NodeStatsSummary, type VolumeAutoscalingSettings } from '@kubwave/kube';
import { isConflict, isNotFound } from '../../../../../shared/cluster/ops.js';
import { CNPG_CLUSTER_NAME, CNPG_GROUP, CNPG_PLURAL, CNPG_VERSION, type CnpgCluster } from '../cnpg.js';
import {
	AT_CAP_REPORTED_ANNOTATION,
	LAST_EXPANDED_ANNOTATION,
	decideExpansion,
	pvcResizeInFlight,
	usedPercent,
	type VolumeAutoscalingState
} from './decide.js';
import { GI, RETRY_ATTEMPTS, emitVolumeEvent, maxPvcUsage, storageClassAllowsExpansion } from './common.js';

async function readCnpgCluster(customApi: CustomObjectsApi, namespace: string): Promise<CnpgCluster | null> {
	try {
		return (await customApi.getNamespacedCustomObject({
			group: CNPG_GROUP,
			version: CNPG_VERSION,
			namespace,
			plural: CNPG_PLURAL,
			name: CNPG_CLUSTER_NAME
		})) as CnpgCluster;
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

// Grow the CNPG Cluster .spec.storage.size, NEVER the instance PVCs directly — the operator propagates the size to every instance online.
export async function reconcilePostgresVolume(
	coreApi: CoreV1Api,
	customApi: CustomObjectsApi,
	storageApi: StorageV1Api,
	namespace: string,
	config: VolumeAutoscalingSettings,
	summaryCache: Map<string, NodeStatsSummary | null>
): Promise<void> {
	const cluster = await readCnpgCluster(customApi, namespace);
	if (!cluster) return; // external DB / statefulset mode - nothing to scale

	const specSizeBytes = parseMemoryToBytes(cluster.spec?.storage?.size);
	const capBytes = parseMemoryToBytes(config.caps.postgres);
	if (specSizeBytes == null || capBytes == null) return;

	// Resize is in flight while ANY instance PVC lags the Cluster size or reports resize conditions.
	const pvcList = await coreApi.listNamespacedPersistentVolumeClaim({ namespace, labelSelector: CNPG_POD_SELECTOR });
	const instancePvcs = pvcList.items as V1PersistentVolumeClaim[];
	const lagging = instancePvcs.some(pvc => {
		const requested = parseMemoryToBytes(pvc.spec?.resources?.requests?.storage as string | undefined);
		return requested != null && requested < specSizeBytes;
	});
	const resizeInFlight = lagging || instancePvcs.some(pvcResizeInFlight);

	const usage = await maxPvcUsage(coreApi, namespace, CNPG_POD_SELECTOR, name => CNPG_DATA_PVC.test(name), summaryCache);
	const state: VolumeAutoscalingState = {
		volume: 'postgres',
		usedBytes: usage?.usedBytes ?? null,
		statsCapacityBytes: usage?.capacityBytes ?? null,
		specSizeBytes,
		capBytes,
		expansionSupported: await storageClassAllowsExpansion(storageApi, instancePvcs[0]?.spec?.storageClassName ?? cluster.spec?.storage?.storageClass),
		resizeInFlight,
		lastExpandedAt: cluster.metadata?.annotations?.[LAST_EXPANDED_ANNOTATION] ?? null
	};
	const decision = decideExpansion(state, config, new Date());
	const involved = {
		kind: 'Cluster',
		name: CNPG_CLUSTER_NAME,
		apiVersion: `${CNPG_GROUP}/${CNPG_VERSION}`,
		uid: (cluster.metadata as { uid?: string } | undefined)?.uid
	};

	if (decision.action === 'none') {
		const pct = usedPercent(state);
		if (pct != null && pct > config.thresholdPercent) {
			console.warn(`[volume-autoscaling] postgres over threshold but not expanding: ${decision.reason}`);
		}
		return;
	}

	for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
		const fresh = await readCnpgCluster(customApi, namespace);
		if (!fresh?.spec?.storage) return;
		const annotations = { ...fresh.metadata?.annotations };
		if (decision.action === 'at-cap') {
			const sizeNow = String(fresh.spec.storage.size ?? '');
			if (annotations[AT_CAP_REPORTED_ANNOTATION] === sizeNow) return;
			annotations[AT_CAP_REPORTED_ANNOTATION] = sizeNow;
		} else {
			// Shrink-race guard: a concurrent grow (admin/helm) must never be overwritten with a smaller size.
			const freshSize = parseMemoryToBytes(fresh.spec.storage.size);
			if (freshSize != null && freshSize >= decision.newSizeGi * GI) return;
			annotations[LAST_EXPANDED_ANNOTATION] = new Date().toISOString();
			delete annotations[AT_CAP_REPORTED_ANNOTATION];
			fresh.spec.storage = { ...fresh.spec.storage, size: `${decision.newSizeGi}Gi` };
		}
		fresh.metadata = { ...fresh.metadata, annotations };
		try {
			await customApi.replaceNamespacedCustomObject({
				group: CNPG_GROUP,
				version: CNPG_VERSION,
				namespace,
				plural: CNPG_PLURAL,
				name: CNPG_CLUSTER_NAME,
				body: fresh
			});
			break;
		} catch (err) {
			if (!isConflict(err) || attempt === RETRY_ATTEMPTS) throw err;
		}
	}

	if (decision.action === 'expand') {
		console.log(`[volume-autoscaling] expanded postgres storage to ${decision.newSizeGi}Gi (CNPG resizes the instance PVCs online)`);
		await emitVolumeEvent(
			coreApi,
			namespace,
			involved,
			'Normal',
			'VolumeExpanded',
			`Postgres storage grown to ${decision.newSizeGi}Gi (usage crossed ${config.thresholdPercent}%).`
		);
	} else {
		console.warn(`[volume-autoscaling] postgres volume at its ${config.caps.postgres} cap - manual action required`);
		await emitVolumeEvent(
			coreApi,
			namespace,
			involved,
			'Warning',
			'VolumeAtCap',
			`Postgres storage is over ${config.thresholdPercent}% full but already at its ${config.caps.postgres} cap. Raise the cap or clean up.`
		);
	}
}
