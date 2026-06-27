import type { V1PersistentVolumeClaim } from '@kubernetes/client-node';
import { parseMemoryToBytes } from '@kubwave/kube';

// Pure decision logic: should postgres/registry volumes grow, given kubelet usage + the admin setting. I/O-free for unit-testability.

const GI = 1024 ** 3;
// At most one expansion per volume per hour: CSI resizes take time to settle and some providers rate-limit. Tracked via the last-expanded annotation.
const EXPANSION_COOLDOWN_MS = 60 * 60 * 1000;

// Annotations on the patched object (registry PVC / CNPG Cluster CR).
export const LAST_EXPANDED_ANNOTATION = 'kubwave/last-expanded-at';
// Spec size the at-cap Warning was last emitted for, so the sweep warns once per size instead of flooding Events (growing or raising the cap resets it).
export const AT_CAP_REPORTED_ANNOTATION = 'kubwave/at-cap-reported';

export type PlatformVolume = 'postgres' | 'registry' | 'prometheus';

export interface VolumeAutoscalingState {
	volume: PlatformVolume;
	// From the kubelet Summary API; null -> no stats found (pod down, node summary failed).
	usedBytes: number | null;
	statsCapacityBytes: number | null;
	// Declared size: PVC spec request (registry) / Cluster .spec.storage.size (postgres).
	specSizeBytes: number;
	capBytes: number;
	expansionSupported: boolean;
	resizeInFlight: boolean;
	// ISO timestamp from LAST_EXPANDED_ANNOTATION, if present.
	lastExpandedAt: string | null;
}

export type ExpansionDecision = { action: 'none'; reason: string } | { action: 'expand'; newSizeGi: number } | { action: 'at-cap' };

export function usedPercent(state: Pick<VolumeAutoscalingState, 'usedBytes' | 'statsCapacityBytes'>): number | null {
	if (state.usedBytes == null || !state.statsCapacityBytes) return null;
	return (state.usedBytes / state.statsCapacityBytes) * 100;
}

// Next size in whole Gi: grow by growthPercent (rounded up), clamped to the cap; <=0 growthPercent is treated as 0 so the volume never shrinks.
export function nextSizeGi(specSizeBytes: number, growthPercent: number, capBytes: number): number {
	const grownGi = Math.ceil((specSizeBytes / GI) * (1 + Math.max(0, growthPercent) / 100));
	return Math.min(grownGi, Math.floor(capBytes / GI));
}

export function decideExpansion(
	state: VolumeAutoscalingState,
	config: { thresholdPercent: number; growthPercent: number },
	now: Date
): ExpansionDecision {
	const pct = usedPercent(state);
	if (pct == null) return { action: 'none', reason: 'no kubelet stats for this volume' };
	if (pct <= config.thresholdPercent) return { action: 'none', reason: 'below threshold' };
	if (!state.expansionSupported) return { action: 'none', reason: 'StorageClass does not allow volume expansion' };
	if (state.resizeInFlight) return { action: 'none', reason: 'a resize is already in flight' };
	if (state.lastExpandedAt) {
		const last = Date.parse(state.lastExpandedAt);
		if (Number.isFinite(last) && now.getTime() - last < EXPANSION_COOLDOWN_MS) {
			return { action: 'none', reason: 'cooldown since last expansion' };
		}
	}
	const newSizeGi = nextSizeGi(state.specSizeBytes, config.growthPercent, state.capBytes);
	if (newSizeGi * GI <= state.specSizeBytes) return { action: 'at-cap' };
	return { action: 'expand', newSizeGi };
}

// A resize is in progress while requested size outruns realized capacity, or while CSI/kubelet resize conditions are still True.
export function pvcResizeInFlight(pvc: V1PersistentVolumeClaim): boolean {
	const requested = parseMemoryToBytes(pvc.spec?.resources?.requests?.storage as string | undefined);
	const actual = parseMemoryToBytes(pvc.status?.capacity?.storage as string | undefined);
	if (requested != null && actual != null && requested > actual) return true;
	return (pvc.status?.conditions ?? []).some(c => (c.type === 'Resizing' || c.type === 'FileSystemResizePending') && c.status === 'True');
}
