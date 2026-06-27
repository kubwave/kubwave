import { describe, expect, test } from 'bun:test';
import { DEFAULT_VOLUME_AUTOSCALING, resolveVolumeAutoscaling } from '@kubwave/kube';

describe('resolveVolumeAutoscaling', () => {
	test('null/undefined row resolves to the defaults (disabled, 80/50, 100Gi/200Gi/50Gi)', () => {
		expect(resolveVolumeAutoscaling(null)).toEqual(DEFAULT_VOLUME_AUTOSCALING);
		expect(resolveVolumeAutoscaling(undefined)).toEqual({
			enabled: false,
			thresholdPercent: 80,
			growthPercent: 50,
			caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
		});
		expect(resolveVolumeAutoscaling({})).toEqual(DEFAULT_VOLUME_AUTOSCALING);
	});

	test('stored values override defaults field-by-field (partial rows stay valid)', () => {
		const resolved = resolveVolumeAutoscaling({ enabled: true, caps: { postgres: '500Gi' } });
		expect(resolved.enabled).toBe(true);
		expect(resolved.thresholdPercent).toBe(80);
		expect(resolved.caps.postgres).toBe('500Gi');
		expect(resolved.caps.registry).toBe('200Gi');
		expect(resolved.caps.prometheus).toBe('50Gi');
	});
});

import type { V1PersistentVolumeClaim } from '@kubernetes/client-node';
import {
	decideExpansion,
	nextSizeGi,
	pvcResizeInFlight,
	usedPercent,
	type VolumeAutoscalingState
} from '~/modules/worker/jobs/platform/volume-autoscaling/decide';

const GI = 1024 ** 3;
const NOW = new Date('2026-06-09T12:00:00Z');

function state(overrides: Partial<VolumeAutoscalingState> = {}): VolumeAutoscalingState {
	return {
		volume: 'registry',
		usedBytes: 18 * GI,
		statsCapacityBytes: 20 * GI,
		specSizeBytes: 20 * GI,
		capBytes: 200 * GI,
		expansionSupported: true,
		resizeInFlight: false,
		lastExpandedAt: null,
		...overrides
	};
}

describe('usedPercent', () => {
	test('used/capacity as a percentage; null when stats are missing', () => {
		expect(usedPercent(state())).toBe(90);
		expect(usedPercent(state({ usedBytes: null }))).toBeNull();
		expect(usedPercent(state({ statsCapacityBytes: null }))).toBeNull();
		expect(usedPercent(state({ statsCapacityBytes: 0 }))).toBeNull();
	});
});

describe('nextSizeGi', () => {
	test('grows by growthPercent, rounded UP to whole Gi', () => {
		expect(nextSizeGi(20 * GI, 50, 200 * GI)).toBe(30);
		expect(nextSizeGi(10 * GI, 25, 200 * GI)).toBe(13); // 12.5 → ceil
	});

	test('clamps to the cap', () => {
		expect(nextSizeGi(150 * GI, 50, 200 * GI)).toBe(200);
		expect(nextSizeGi(200 * GI, 50, 200 * GI)).toBe(200);
	});
});

describe('decideExpansion', () => {
	test('expands when over threshold and all guards pass', () => {
		expect(decideExpansion(state(), { thresholdPercent: 80, growthPercent: 50 }, NOW)).toEqual({ action: 'expand', newSizeGi: 30 });
	});

	test('does nothing below or at the threshold', () => {
		const calm = state({ usedBytes: 10 * GI });
		expect(decideExpansion(calm, { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('none');
		const exactly = state({ usedBytes: 16 * GI }); // 80% — not OVER the threshold
		expect(decideExpansion(exactly, { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('none');
	});

	test('skips when stats are unavailable, expansion unsupported, or a resize is in flight', () => {
		expect(decideExpansion(state({ usedBytes: null }), { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('none');
		expect(decideExpansion(state({ expansionSupported: false }), { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('none');
		expect(decideExpansion(state({ resizeInFlight: true }), { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('none');
	});

	test('honors the 1h cooldown since the last expansion', () => {
		const recent = state({ lastExpandedAt: '2026-06-09T11:30:00Z' });
		expect(decideExpansion(recent, { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('none');
		const stale = state({ lastExpandedAt: '2026-06-09T10:59:00Z' });
		expect(decideExpansion(stale, { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('expand');
		const garbage = state({ lastExpandedAt: 'not-a-date' }); // unparseable → treated as no cooldown
		expect(decideExpansion(garbage, { thresholdPercent: 80, growthPercent: 50 }, NOW).action).toBe('expand');
	});

	test('reports at-cap when the next size cannot exceed the current size', () => {
		const full = state({ specSizeBytes: 200 * GI, usedBytes: 190 * GI, statsCapacityBytes: 200 * GI });
		expect(decideExpansion(full, { thresholdPercent: 80, growthPercent: 50 }, NOW)).toEqual({ action: 'at-cap' });
		const overCap = state({ specSizeBytes: 250 * GI, usedBytes: 240 * GI, statsCapacityBytes: 250 * GI });
		expect(decideExpansion(overCap, { thresholdPercent: 80, growthPercent: 50 }, NOW)).toEqual({ action: 'at-cap' });
	});
});

describe('pvcResizeInFlight', () => {
	const pvc = (requested: string, actual: string | undefined, conditions: Array<{ type: string; status: string }> = []): V1PersistentVolumeClaim =>
		({
			spec: { resources: { requests: { storage: requested } } },
			status: { ...(actual ? { capacity: { storage: actual } } : {}), conditions }
		}) as V1PersistentVolumeClaim;

	test('requested > actual capacity means a resize is progressing', () => {
		expect(pvcResizeInFlight(pvc('30Gi', '20Gi'))).toBe(true);
		expect(pvcResizeInFlight(pvc('20Gi', '20Gi'))).toBe(false);
	});

	test('Resizing / FileSystemResizePending conditions count as in flight', () => {
		expect(pvcResizeInFlight(pvc('20Gi', '20Gi', [{ type: 'Resizing', status: 'True' }]))).toBe(true);
		expect(pvcResizeInFlight(pvc('20Gi', '20Gi', [{ type: 'FileSystemResizePending', status: 'True' }]))).toBe(true);
		expect(pvcResizeInFlight(pvc('20Gi', '20Gi', [{ type: 'Resizing', status: 'False' }]))).toBe(false);
	});

	test('missing status (fresh PVC) is not in flight', () => {
		expect(pvcResizeInFlight(pvc('20Gi', undefined))).toBe(false);
		expect(pvcResizeInFlight(pvc('30Gi', undefined))).toBe(false);
	});
});
