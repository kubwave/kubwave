import { CoreV1Api, StorageV1Api } from '@kubernetes/client-node';
import { resolveVolumeAutoscaling, VOLUME_AUTOSCALING_SETTINGS_KEY, type VolumeAutoscalingSettings } from '@kubwave/kube';
import { isNotFound } from '../../../../../shared/cluster/ops.js';

// Re-export from @kubwave/kube; the kubelet-reading impl is shared with the api's read-only usage display.
export { maxPvcUsage } from '@kubwave/kube';

// Cluster I/O shared by the registry + postgres volume sweeps; fill from the kubelet Summary API, decisions in decide.ts. Disabled (default) -> no-op.

export const RETRY_ATTEMPTS = 3;
export const GI = 1024 ** 3;

export async function readAutoscalingSettings(): Promise<VolumeAutoscalingSettings> {
	// Lazy import so the module stays importable without a DB client (mirrors ha.ts).
	const { db, settings } = await import('@kubwave/db');
	const { eq } = await import('drizzle-orm');
	const [row] = await db.select().from(settings).where(eq(settings.key, VOLUME_AUTOSCALING_SETTINGS_KEY)).limit(1);
	return resolveVolumeAutoscaling(row?.value);
}

export async function storageClassAllowsExpansion(storageApi: StorageV1Api, name: string | undefined): Promise<boolean> {
	if (!name) return false; // unresolved class on the PVC - don't guess
	try {
		const sc = await storageApi.readStorageClass({ name });
		return sc.allowVolumeExpansion === true;
	} catch (err) {
		if (isNotFound(err)) return false;
		throw err;
	}
}

// Emit a Kubernetes Event on the grown/at-cap object; uid makes it show in `kubectl describe`. Failures only warn — visibility must never break the sweep.
export async function emitVolumeEvent(
	coreApi: CoreV1Api,
	namespace: string,
	involved: { kind: string; name: string; apiVersion: string; uid?: string },
	type: 'Normal' | 'Warning',
	reason: string,
	message: string
): Promise<void> {
	const now = new Date();
	try {
		await coreApi.createNamespacedEvent({
			namespace,
			body: {
				metadata: { generateName: 'kubwave-volume-autoscaler-', namespace },
				involvedObject: { ...involved, namespace },
				reason,
				message,
				type,
				source: { component: 'kubwave-worker' },
				firstTimestamp: now,
				lastTimestamp: now,
				count: 1
			}
		});
	} catch (err) {
		console.warn(`[volume-autoscaling] could not emit ${reason} event for ${involved.kind}/${involved.name}:`, err);
	}
}
