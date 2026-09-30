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

test('accepts every Kubernetes memory quantity form from existing worker env values', () => {
	for (const [memoryRequest, memoryLimit] of [
		['512M', '2G'],
		['1500000000', '2000000000'],
		['1e9', '2e9'],
		['1536Mi', '2Gi'],
		['1G', '1Gi']
	]) {
		expect(() => resolveBuildSettings(null, { memoryRequest, memoryLimit })).not.toThrow();
	}
	const base = resolveBuildSettings(null);
	expect(buildSettingsSchema.safeParse({ ...base, memoryRequest: '2Gi', memoryLimit: '2G' }).success).toBe(false);
	for (const memoryRequest of ['0x10', 'Gi', '1.2.3G', '5n', '1Gix']) {
		expect(buildSettingsSchema.safeParse({ ...base, memoryRequest }).success).toBe(false);
	}
});
