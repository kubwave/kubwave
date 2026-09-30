import { expect, test } from 'bun:test';
import { buildSettingsSchema, resolveBuildSettings } from '~/shared/builds/settings';

test('keeps existing worker memory defaults until an admin saves settings', () => {
	expect(resolveBuildSettings(null, { memoryRequest: '3Gi', memoryLimit: '6Gi', timeoutSeconds: 900 })).toMatchObject({
		execution: 'cluster',
		memoryRequest: '3Gi',
		memoryLimit: '6Gi',
		timeoutSeconds: 900,
		cpuRequest: '',
		cpuLimit: ''
	});
});

test('validates resource quantities and compares their actual values', () => {
	const base = resolveBuildSettings(null);
	expect(buildSettingsSchema.safeParse({ ...base, cpuRequest: '500m', cpuLimit: '1', memoryRequest: '1024Mi', memoryLimit: '1Gi' }).success).toBe(
		true
	);
	expect(buildSettingsSchema.safeParse({ ...base, cpuRequest: '2', cpuLimit: '500m' }).success).toBe(false);
	expect(buildSettingsSchema.safeParse({ ...base, memoryRequest: '2Gi', memoryLimit: '1024Mi' }).success).toBe(false);
	for (const memoryRequest of ['-1Gi', '0Gi', 'Infinity', 'wat', '1Gi;echo bad']) {
		expect(buildSettingsSchema.safeParse({ ...base, memoryRequest }).success).toBe(false);
	}
});
