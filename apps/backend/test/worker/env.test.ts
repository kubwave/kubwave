import { describe, expect, test } from 'bun:test';

import { resolveBuildEngine, resolveWorkerRuntimeConfig } from '~/shared/config/worker-env';

describe('resolveBuildEngine', () => {
	test('defaults to buildkit and accepts buildkit', () => {
		expect(resolveBuildEngine(undefined)).toBe('buildkit');
		expect(resolveBuildEngine('')).toBe('buildkit');
		expect(resolveBuildEngine('buildkit')).toBe('buildkit');
	});

	test('rejects unsupported engines', () => {
		expect(() => resolveBuildEngine('kaniko')).toThrow('BUILD_ENGINE=kaniko is not supported');
	});
});

describe('tenantDefaultResources', () => {
	test('defaults to a cpu+memory request baseline', () => {
		delete process.env.TENANT_DEFAULT_RESOURCES;
		expect(resolveWorkerRuntimeConfig().tenantDefaultResources).toEqual({ cpuRequest: '50m', memoryRequest: '128Mi' });
	});

	test('parses TENANT_DEFAULT_RESOURCES JSON', () => {
		process.env.TENANT_DEFAULT_RESOURCES = '{"cpuRequest":"100m","memoryRequest":"256Mi","memoryLimit":"512Mi"}';
		expect(resolveWorkerRuntimeConfig().tenantDefaultResources).toEqual({ cpuRequest: '100m', memoryRequest: '256Mi', memoryLimit: '512Mi' });
		delete process.env.TENANT_DEFAULT_RESOURCES;
	});

	test('falls back to the baseline on invalid JSON', () => {
		process.env.TENANT_DEFAULT_RESOURCES = 'not-json';
		expect(resolveWorkerRuntimeConfig().tenantDefaultResources).toEqual({ cpuRequest: '50m', memoryRequest: '128Mi' });
		delete process.env.TENANT_DEFAULT_RESOURCES;
	});
});
