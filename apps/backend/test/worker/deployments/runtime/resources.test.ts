import { describe, expect, test } from 'bun:test';
import type { V1ResourceRequirements } from '@kubernetes/client-node';
import type { DockerImageServiceConfig } from '@kubwave/db';
import { buildResources, resourcesMatch } from '~/modules/worker/jobs/deployments/deployers/runtime/resources';

function configWith(resources: DockerImageServiceConfig['resources']): DockerImageServiceConfig {
	return { image: 'nginx', tag: 'latest', containerPort: 8080, env: [], domains: [], volumes: [], resources };
}

// resourcesMatch guards the reconciler's change-detection: a container whose resources already
// reflect the config must read as equal, or the worker re-writes the Deployment on every tick.
describe('resourcesMatch', () => {
	test('no resources configured matches a container with no resources', () => {
		expect(resourcesMatch({}, configWith(undefined))).toBe(true);
		expect(resourcesMatch({ resources: {} }, configWith(undefined))).toBe(true);
	});

	test('matching requests and limits read as equal', () => {
		const live: V1ResourceRequirements = { requests: { cpu: '250m', memory: '256Mi' }, limits: { cpu: '500m', memory: '512Mi' } };
		const config = configWith({ cpuRequest: '250m', cpuLimit: '500m', memoryRequest: '256Mi', memoryLimit: '512Mi' });
		expect(resourcesMatch({ resources: live }, config)).toBe(true);
	});

	test('partial config (limits only) matches a container with only limits', () => {
		const live: V1ResourceRequirements = { limits: { cpu: '500m', memory: '512Mi' } };
		const config = configWith({ cpuLimit: '500m', memoryLimit: '512Mi' });
		expect(resourcesMatch({ resources: live }, config)).toBe(true);
	});

	test('a differing limit is a mismatch', () => {
		const live: V1ResourceRequirements = { limits: { cpu: '500m', memory: '512Mi' } };
		const config = configWith({ cpuLimit: '1', memoryLimit: '512Mi' });
		expect(resourcesMatch({ resources: live }, config)).toBe(false);
	});

	test('config sets resources but container has none', () => {
		expect(resourcesMatch({}, configWith({ memoryLimit: '512Mi' }))).toBe(false);
	});

	// The API server stores quantities canonicalized, so what we write back is not what we read:
	// `1000m` returns as `1`. Comparing the raw strings never converges and the reconciler
	// rewrites the Deployment on every tick.
	test('quantities equal after canonicalization read as equal', () => {
		const live: V1ResourceRequirements = { limits: { cpu: '1' } };
		expect(resourcesMatch({ resources: live }, configWith({ cpuLimit: '1000m' }))).toBe(true);
	});

	test('binary memory suffixes compare by value', () => {
		const live: V1ResourceRequirements = { limits: { memory: '1Gi' } };
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1024Mi' }))).toBe(true);
	});

	test('a fractional cpu matches its milli form', () => {
		const live: V1ResourceRequirements = { requests: { cpu: '500m' } };
		expect(resourcesMatch({ resources: live }, configWith({ cpuRequest: '0.5' }))).toBe(true);
	});

	test('container has resources but config is empty', () => {
		const live: V1ResourceRequirements = { limits: { memory: '512Mi' } };
		expect(resourcesMatch({ resources: live }, configWith(undefined))).toBe(false);
	});
});

const DEFAULTS = { cpuRequest: '50m', memoryRequest: '128Mi' };

describe('buildResources defaults', () => {
	test('applies the cluster defaults when the service configures nothing', () => {
		expect(buildResources(undefined, DEFAULTS)).toEqual({ requests: { cpu: '50m', memory: '128Mi' } });
	});

	test('per-service config overrides the defaults field-by-field', () => {
		expect(buildResources({ memoryRequest: '512Mi', memoryLimit: '1Gi' }, DEFAULTS)).toEqual({
			requests: { cpu: '50m', memory: '512Mi' },
			limits: { memory: '1Gi' }
		});
	});

	test('no defaults and no config yields undefined', () => {
		expect(buildResources(undefined, undefined)).toBeUndefined();
	});

	test('empty-string per-service values fall back to the defaults', () => {
		expect(buildResources({ cpuRequest: '', memoryRequest: '', cpuLimit: '', memoryLimit: '' }, DEFAULTS)).toEqual({
			requests: { cpu: '50m', memory: '128Mi' }
		});
	});

	test('whitespace-only per-service values fall back to the defaults', () => {
		expect(buildResources({ cpuRequest: '  ', memoryLimit: '\t' }, DEFAULTS)).toEqual({
			requests: { cpu: '50m', memory: '128Mi' }
		});
	});

	test('blank per-service values with no defaults are omitted', () => {
		expect(buildResources({ cpuRequest: '', memoryLimit: '   ' }, undefined)).toBeUndefined();
	});
});

describe('resourcesMatch with defaults', () => {
	test('a container carrying the defaults matches an unconfigured service', () => {
		const live: V1ResourceRequirements = { requests: { cpu: '50m', memory: '128Mi' } };
		expect(resourcesMatch({ resources: live }, configWith(undefined), DEFAULTS)).toBe(true);
	});

	test('a container missing the defaults is a mismatch (rolls once to apply them)', () => {
		expect(resourcesMatch({}, configWith(undefined), DEFAULTS)).toBe(false);
	});
});
