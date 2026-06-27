import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_METRICS_PROVIDER,
	DEFAULT_MAX_CONCURRENT_DEPLOYMENTS,
	DEFAULT_MAX_PREVIEWS_PER_PROJECT,
	DEFAULT_VOLUME_AUTOSCALING,
	DEPLOYMENT_CONCURRENCY_SETTINGS_KEY,
	getKubeConfig,
	HA_SETTINGS_KEY,
	isConflict,
	isNotFound,
	METRICS_SETTINGS_KEY,
	PLATFORM_CONFIGMAP_NAME,
	PR_PREVIEW_SETTINGS_KEY,
	resolveDeploymentConcurrencySettings,
	resolveHaSettings,
	resolvePrPreviewSettings,
	resolveVolumeAutoscaling,
	UPDATE_JOB_TEMPLATE_CONFIGMAP_NAME,
	VOLUME_AUTOSCALING_SETTINGS_KEY
} from '../src/index';

describe('barrel exports', () => {
	test('re-exports package root constants and helpers', () => {
		expect(PLATFORM_CONFIGMAP_NAME).toBe('kubwave-platform');
		expect(UPDATE_JOB_TEMPLATE_CONFIGMAP_NAME).toBe('update-job-template');
		expect(METRICS_SETTINGS_KEY).toBe('metrics-provider');
		expect(DEFAULT_METRICS_PROVIDER).toBe('live');
		expect(VOLUME_AUTOSCALING_SETTINGS_KEY).toBe('volume-autoscaling');
		expect(HA_SETTINGS_KEY).toBe('ha');
		expect(DEPLOYMENT_CONCURRENCY_SETTINGS_KEY).toBe('deployment-concurrency');
		expect(DEFAULT_MAX_CONCURRENT_DEPLOYMENTS).toBe(3);
		expect(PR_PREVIEW_SETTINGS_KEY).toBe('pr-preview');
		expect(DEFAULT_MAX_PREVIEWS_PER_PROJECT).toBe(5);
		expect(DEFAULT_VOLUME_AUTOSCALING).toEqual({
			enabled: false,
			thresholdPercent: 80,
			growthPercent: 50,
			caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
		});
		expect(resolveVolumeAutoscaling(null)).toEqual(DEFAULT_VOLUME_AUTOSCALING);
		expect(resolveHaSettings({ enabled: true })).toEqual({ enabled: true });
		expect(resolveDeploymentConcurrencySettings({ maxConcurrentDeployments: 2 })).toEqual({ maxConcurrentDeployments: 2 });
		expect(resolvePrPreviewSettings({ maxPreviewsPerProject: 0 })).toEqual({ maxPreviewsPerProject: 0 });
		expect(isNotFound({ code: 404 })).toBe(true);
		expect(isConflict({ code: 409 })).toBe(true);
		expect(getKubeConfig).toBeFunction();
	});
});
