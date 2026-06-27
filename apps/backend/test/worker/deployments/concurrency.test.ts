import { describe, expect, mock, test } from 'bun:test';

// Drive getMaxConcurrentDeployments' settings lookup through a single-row queue.
let settingsRow: unknown[] = [];
mock.module('@kubwave/db', () => ({
	settings: { key: 'key', value: 'value' },
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: async () => settingsRow }) }) })
	}
}));

const { normalizeMax, computeClaimLimit, getMaxConcurrentDeployments, DEFAULT_MAX_CONCURRENT_DEPLOYMENTS, DEPLOYMENT_CONCURRENCY_SETTINGS_KEY } =
	await import('~/modules/worker/jobs/deployments/concurrency');

describe('normalizeMax', () => {
	test('keeps a valid positive integer', () => {
		expect(normalizeMax(5)).toBe(5);
		expect(normalizeMax(1)).toBe(1);
	});

	test('falls back to the default for missing, non-integer, or sub-1 values', () => {
		expect(normalizeMax(undefined)).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
		expect(normalizeMax(null)).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
		expect(normalizeMax(0)).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
		expect(normalizeMax(-3)).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
		expect(normalizeMax(2.5)).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
		expect(normalizeMax('4')).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
	});
});

describe('computeClaimLimit', () => {
	test('returns the free slots under the cap when below the batch', () => {
		// max 3, 1 already in flight → 2 free slots, batch 5 → claim 2
		expect(computeClaimLimit(3, 1, 5)).toBe(2);
	});

	test('is bounded by the per-tick batch', () => {
		// max 20, 0 in flight → 20 free, but batch caps it at 5
		expect(computeClaimLimit(20, 0, 5)).toBe(5);
	});

	test('returns 0 when the cap is already met or exceeded', () => {
		expect(computeClaimLimit(3, 3, 5)).toBe(0);
		expect(computeClaimLimit(3, 4, 5)).toBe(0);
	});
});

describe('constants', () => {
	test('exposes the shared settings key the API mirrors', () => {
		expect(DEPLOYMENT_CONCURRENCY_SETTINGS_KEY).toBe('deployment-concurrency');
		expect(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS).toBe(3);
	});
});

describe('getMaxConcurrentDeployments', () => {
	test('reads + normalizes a stored value', async () => {
		settingsRow = [{ key: 'deployment-concurrency', value: { maxConcurrentDeployments: 7 } }];
		expect(await getMaxConcurrentDeployments()).toBe(7);
	});

	test('falls back to the default when the setting is missing', async () => {
		settingsRow = [];
		expect(await getMaxConcurrentDeployments()).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
	});

	test('falls back to the default for a bad stored value (sub-1)', async () => {
		settingsRow = [{ key: 'deployment-concurrency', value: { maxConcurrentDeployments: 0 } }];
		expect(await getMaxConcurrentDeployments()).toBe(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS);
	});
});
