import { CoreV1Api, StorageV1Api } from '@kubernetes/client-node';
import { parseMemoryToBytes, REGISTRY_POD_SELECTOR, REGISTRY_PVC_NAME, type NodeStatsSummary, type VolumeAutoscalingSettings } from '@kubwave/kube';
import { isConflict, readPVCOrNull } from '../../../../../shared/cluster/ops.js';
import {
	AT_CAP_REPORTED_ANNOTATION,
	LAST_EXPANDED_ANNOTATION,
	decideExpansion,
	pvcResizeInFlight,
	usedPercent,
	type VolumeAutoscalingState
} from './decide.js';
import { GI, RETRY_ATTEMPTS, emitVolumeEvent, maxPvcUsage, storageClassAllowsExpansion } from './common.js';

// Grow the registry PVC directly: spec.resources.requests.storage is the one mutable PVC field.
export async function reconcileRegistryVolume(
	coreApi: CoreV1Api,
	storageApi: StorageV1Api,
	namespace: string,
	config: VolumeAutoscalingSettings,
	summaryCache: Map<string, NodeStatsSummary | null>
): Promise<void> {
	const pvc = await readPVCOrNull(coreApi, namespace, REGISTRY_PVC_NAME);
	if (!pvc) return; // registry disabled (dev) - nothing to scale

	const specSizeBytes = parseMemoryToBytes(pvc.spec?.resources?.requests?.storage as string | undefined);
	const capBytes = parseMemoryToBytes(config.caps.registry);
	if (specSizeBytes == null || capBytes == null) return;

	const usage = await maxPvcUsage(coreApi, namespace, REGISTRY_POD_SELECTOR, name => name === REGISTRY_PVC_NAME, summaryCache);
	const state: VolumeAutoscalingState = {
		volume: 'registry',
		usedBytes: usage?.usedBytes ?? null,
		statsCapacityBytes: usage?.capacityBytes ?? null,
		specSizeBytes,
		capBytes,
		expansionSupported: await storageClassAllowsExpansion(storageApi, pvc.spec?.storageClassName ?? undefined),
		resizeInFlight: pvcResizeInFlight(pvc),
		lastExpandedAt: pvc.metadata?.annotations?.[LAST_EXPANDED_ANNOTATION] ?? null
	};
	const decision = decideExpansion(state, config, new Date());
	const involved = { kind: 'PersistentVolumeClaim', name: REGISTRY_PVC_NAME, apiVersion: 'v1', uid: pvc.metadata?.uid };

	if (decision.action === 'none') {
		const pct = usedPercent(state);
		if (pct != null && pct > config.thresholdPercent) {
			console.warn(`[volume-autoscaling] registry over threshold but not expanding: ${decision.reason}`);
		}
		return;
	}

	for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
		const fresh = await readPVCOrNull(coreApi, namespace, REGISTRY_PVC_NAME);
		if (!fresh?.spec?.resources) return;
		const annotations = { ...fresh.metadata?.annotations };
		if (decision.action === 'at-cap') {
			// Warn once per size: skip if this size was already reported.
			const sizeNow = String(fresh.spec.resources.requests?.storage ?? '');
			if (annotations[AT_CAP_REPORTED_ANNOTATION] === sizeNow) return;
			annotations[AT_CAP_REPORTED_ANNOTATION] = sizeNow;
		} else {
			// Shrink-race guard: a concurrent grow must never be overwritten with a smaller size.
			const freshSize = parseMemoryToBytes(fresh.spec.resources.requests?.storage as string | undefined);
			if (freshSize != null && freshSize >= decision.newSizeGi * GI) return;
			annotations[LAST_EXPANDED_ANNOTATION] = new Date().toISOString();
			delete annotations[AT_CAP_REPORTED_ANNOTATION];
			fresh.spec.resources = { ...fresh.spec.resources, requests: { ...fresh.spec.resources.requests, storage: `${decision.newSizeGi}Gi` } };
		}
		fresh.metadata = { ...fresh.metadata, annotations };
		try {
			await coreApi.replaceNamespacedPersistentVolumeClaim({ name: REGISTRY_PVC_NAME, namespace, body: fresh });
			break;
		} catch (err) {
			if (!isConflict(err) || attempt === RETRY_ATTEMPTS) throw err;
		}
	}

	if (decision.action === 'expand') {
		console.log(`[volume-autoscaling] expanded registry PVC to ${decision.newSizeGi}Gi`);
		await emitVolumeEvent(
			coreApi,
			namespace,
			involved,
			'Normal',
			'VolumeExpanded',
			`Registry volume grown to ${decision.newSizeGi}Gi (usage crossed ${config.thresholdPercent}%).`
		);
	} else {
		console.warn(`[volume-autoscaling] registry volume at its ${config.caps.registry} cap - manual action required`);
		await emitVolumeEvent(
			coreApi,
			namespace,
			involved,
			'Warning',
			'VolumeAtCap',
			`Registry volume is over ${config.thresholdPercent}% full but already at its ${config.caps.registry} cap. Raise the cap or clean up.`
		);
	}
}
