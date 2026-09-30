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

test('fills fields missing from a stored row with the defaults', () => {
	expect(resolveBuildSettings({ execution: 'agent', fallbackToCluster: true }, { memoryRequest: '3Gi', memoryLimit: '6Gi' })).toMatchObject({
		execution: 'agent',
		fallbackToCluster: true,
		memoryRequest: '3Gi',
		memoryLimit: '6Gi',
		queueTimeoutSeconds: 86400
	});
});

test('falls back to the defaults when the stored row is invalid instead of throwing', () => {
	const defaults = { memoryRequest: '3Gi', memoryLimit: '6Gi', timeoutSeconds: 900 };
	for (const raw of ['garbage', 42, { timeoutSeconds: 5 }, { memoryRequest: 'wat' }]) {
		expect(resolveBuildSettings(raw, defaults)).toEqual(resolveBuildSettings(null, defaults));
	}
});

test('keeps an out-of-range env timeout instead of breaking every build', () => {
	expect(resolveBuildSettings(null, { timeoutSeconds: 30 }).timeoutSeconds).toBe(30);
});

test('keeps stored settings when an env default is out of range', () => {
	const stored = { ...resolveBuildSettings(null), execution: 'agent' as const, maxConcurrentBuilds: 7, timeoutSeconds: 1200 };
	expect(resolveBuildSettings(stored, { timeoutSeconds: 30 })).toEqual(stored);
	expect(resolveBuildSettings({ execution: 'agent', maxConcurrentBuilds: 7 }, { timeoutSeconds: 30 })).toMatchObject({
		execution: 'agent',
		maxConcurrentBuilds: 7,
		timeoutSeconds: 1800
	});
});
