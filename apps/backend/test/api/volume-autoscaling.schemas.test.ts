import { describe, expect, test } from 'bun:test';
import { volumeAutoscalingSettingsSchema as updateVolumeAutoscalingSchema } from '~/modules/platform/settings/volume-autoscaling/platform-volume-autoscaling-settings.dto';

const valid = { enabled: true, thresholdPercent: 80, growthPercent: 50, caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' } };

describe('updateVolumeAutoscalingSchema', () => {
	test('accepts a complete valid settings object', () => {
		expect(updateVolumeAutoscalingSchema.safeParse(valid).success).toBe(true);
	});

	test('thresholdPercent is bounded to 50–95', () => {
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, thresholdPercent: 49 }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, thresholdPercent: 96 }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, thresholdPercent: 50 }).success).toBe(true);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, thresholdPercent: 95 }).success).toBe(true);
	});

	test('growthPercent is bounded to 10–100', () => {
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, growthPercent: 9 }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, growthPercent: 101 }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, growthPercent: 10 }).success).toBe(true);
	});

	test('caps must be whole-Gi quantities of at least 10Gi', () => {
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, postgres: '100' } }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, postgres: '1.5Gi' } }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, postgres: '500Mi' } }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, postgres: '9Gi' } }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, postgres: '10Gi' } }).success).toBe(true);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, prometheus: '9Gi' } }).success).toBe(false);
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, caps: { ...valid.caps, prometheus: '10Gi' } }).success).toBe(true);
	});

	test('non-integer percentages are rejected', () => {
		expect(updateVolumeAutoscalingSchema.safeParse({ ...valid, thresholdPercent: 80.5 }).success).toBe(false);
	});
});
