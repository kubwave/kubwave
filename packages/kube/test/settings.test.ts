import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_HA_SETTINGS,
	DEFAULT_METRICS_PROVIDER,
	DEFAULT_MAX_CONCURRENT_DEPLOYMENTS,
	DEFAULT_MAX_PREVIEWS_PER_PROJECT,
	DEFAULT_VOLUME_AUTOSCALING,
	DEPLOYMENT_CONCURRENCY_SETTINGS_KEY,
	HA_SETTINGS_KEY,
	METRICS_SETTINGS_KEY,
	PR_PREVIEW_DEFAULTS,
	PR_PREVIEW_SETTINGS_KEY,
	resolveDeploymentConcurrencySettings,
	resolveHaSettings,
	resolvePrPreviewSettings,
	resolveVolumeAutoscaling,
	VOLUME_AUTOSCALING_SETTINGS_KEY
} from '../src/platform/settings';

describe('settings constants', () => {
	test('match their documented literal values', () => {
		expect(METRICS_SETTINGS_KEY).toBe('metrics-provider');
		expect(DEFAULT_METRICS_PROVIDER).toBe('live');
		expect(VOLUME_AUTOSCALING_SETTINGS_KEY).toBe('volume-autoscaling');
		expect(HA_SETTINGS_KEY).toBe('ha');
		expect(DEPLOYMENT_CONCURRENCY_SETTINGS_KEY).toBe('deployment-concurrency');
		expect(PR_PREVIEW_SETTINGS_KEY).toBe('pr-preview');
	});

	test('DEFAULT_VOLUME_AUTOSCALING is the disabled-by-default config', () => {
		expect(DEFAULT_VOLUME_AUTOSCALING).toEqual({
			enabled: false,
			thresholdPercent: 80,
			growthPercent: 50,
			caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
		});
	});
});

describe('resolveHaSettings', () => {
	test('missing or invalid values return disabled default', () => {
		expect(resolveHaSettings(null)).toEqual(DEFAULT_HA_SETTINGS);
		expect(resolveHaSettings(undefined)).toEqual(DEFAULT_HA_SETTINGS);
		expect(resolveHaSettings({})).toEqual(DEFAULT_HA_SETTINGS);
		expect(resolveHaSettings({ enabled: 'true' })).toEqual(DEFAULT_HA_SETTINGS);
	});

	test('explicit booleans are preserved', () => {
		expect(resolveHaSettings({ enabled: true })).toEqual({ enabled: true });
		expect(resolveHaSettings({ enabled: false })).toEqual({ enabled: false });
	});
});

describe('resolveDeploymentConcurrencySettings', () => {
	test('valid positive integers are preserved', () => {
		expect(resolveDeploymentConcurrencySettings({ maxConcurrentDeployments: 1 })).toEqual({ maxConcurrentDeployments: 1 });
		expect(resolveDeploymentConcurrencySettings({ maxConcurrentDeployments: 7 })).toEqual({ maxConcurrentDeployments: 7 });
	});

	test('missing, non-integer, and sub-1 values fall back to the default', () => {
		for (const raw of [
			null,
			undefined,
			{},
			{ maxConcurrentDeployments: 0 },
			{ maxConcurrentDeployments: -1 },
			{ maxConcurrentDeployments: 2.5 },
			{ maxConcurrentDeployments: '4' }
		]) {
			expect(resolveDeploymentConcurrencySettings(raw)).toEqual({ maxConcurrentDeployments: DEFAULT_MAX_CONCURRENT_DEPLOYMENTS });
		}
	});
});

describe('resolvePrPreviewSettings', () => {
	test('valid non-negative integers are preserved, including 0', () => {
		expect(resolvePrPreviewSettings({ maxPreviewsPerProject: 8 })).toEqual({ maxPreviewsPerProject: 8 });
		expect(resolvePrPreviewSettings({ maxPreviewsPerProject: 0 })).toEqual({ maxPreviewsPerProject: 0 });
	});

	test('missing, non-integer, and negative values fall back to the default', () => {
		expect(PR_PREVIEW_DEFAULTS.maxPreviewsPerProject).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
		for (const raw of [null, undefined, {}, { maxPreviewsPerProject: -1 }, { maxPreviewsPerProject: 2.5 }, { maxPreviewsPerProject: '5' }]) {
			expect(resolvePrPreviewSettings(raw)).toEqual(PR_PREVIEW_DEFAULTS);
		}
	});
});

describe('resolveVolumeAutoscaling', () => {
	test('null returns full defaults', () => {
		expect(resolveVolumeAutoscaling(null)).toEqual(DEFAULT_VOLUME_AUTOSCALING);
	});

	test('undefined returns full defaults', () => {
		expect(resolveVolumeAutoscaling(undefined)).toEqual(DEFAULT_VOLUME_AUTOSCALING);
	});

	test('empty object returns full defaults', () => {
		expect(resolveVolumeAutoscaling({})).toEqual(DEFAULT_VOLUME_AUTOSCALING);
	});

	test('returns a fresh object, not the shared default reference', () => {
		const r = resolveVolumeAutoscaling({});
		expect(r).not.toBe(DEFAULT_VOLUME_AUTOSCALING);
		expect(r.caps).not.toBe(DEFAULT_VOLUME_AUTOSCALING.caps);
	});

	test('top-level fields override defaults, caps untouched returns cap defaults', () => {
		expect(resolveVolumeAutoscaling({ enabled: true, thresholdPercent: 90, growthPercent: 25 })).toEqual({
			enabled: true,
			thresholdPercent: 90,
			growthPercent: 25,
			caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
		});
	});

	test('nested caps.postgres only keeps registry/prometheus defaults', () => {
		expect(resolveVolumeAutoscaling({ caps: { postgres: '50Gi' } }).caps).toEqual({
			postgres: '50Gi',
			registry: '200Gi',
			prometheus: '50Gi'
		});
	});

	test('nested caps.registry only keeps postgres/prometheus defaults', () => {
		expect(resolveVolumeAutoscaling({ caps: { registry: '500Gi' } }).caps).toEqual({
			postgres: '100Gi',
			registry: '500Gi',
			prometheus: '50Gi'
		});
	});

	test('all caps provided are fully honored', () => {
		expect(resolveVolumeAutoscaling({ caps: { postgres: '10Gi', registry: '20Gi', prometheus: '30Gi' } }).caps).toEqual({
			postgres: '10Gi',
			registry: '20Gi',
			prometheus: '30Gi'
		});
	});

	test('garbage primitive string returns full defaults', () => {
		expect(resolveVolumeAutoscaling('garbage')).toEqual(DEFAULT_VOLUME_AUTOSCALING);
	});

	test('garbage primitive number returns full defaults', () => {
		expect(resolveVolumeAutoscaling(42)).toEqual(DEFAULT_VOLUME_AUTOSCALING);
	});

	test('enabled:false explicitly is preserved', () => {
		expect(resolveVolumeAutoscaling({ enabled: false, thresholdPercent: 70 }).enabled).toBe(false);
	});

	test('thresholdPercent:0 explicitly is preserved', () => {
		expect(resolveVolumeAutoscaling({ thresholdPercent: 0 }).thresholdPercent).toBe(0);
	});

	test('a fully-specified config round-trips unchanged', () => {
		const full = { enabled: true, thresholdPercent: 95, growthPercent: 10, caps: { postgres: '1Gi', registry: '2Gi', prometheus: '3Gi' } };
		expect(resolveVolumeAutoscaling(full)).toEqual(full);
	});
});
