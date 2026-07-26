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

// The per-service DTO constrains quantities, but TENANT_DEFAULT_RESOURCES is parsed from unvalidated
// env JSON, so an operator's defaults reach here in any form Kubernetes accepts. The API server only
// echoes back the string it was given when that string is already canonical, so `.5` reads back as
// `500m` — comparison has to be numeric or the reconciler rewrites the Deployment every tick.
describe('resourcesMatch across Kubernetes quantity forms', () => {
	test('a leading-decimal cpu default matches its canonicalized milli form', () => {
		const live: V1ResourceRequirements = { requests: { cpu: '500m' } };
		expect(resourcesMatch({ resources: live }, configWith(undefined), { cpuRequest: '.5' })).toBe(true);
	});

	test('a trailing-decimal cpu matches its whole form', () => {
		const live: V1ResourceRequirements = { limits: { cpu: '5' } };
		expect(resourcesMatch({ resources: live }, configWith({ cpuLimit: '5.' }))).toBe(true);
	});

	test('exponent notation matches the expanded form', () => {
		const live: V1ResourceRequirements = { limits: { memory: '1G' } };
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1e9' }))).toBe(true);
	});

	test('a negative exponent matches its milli form', () => {
		const live: V1ResourceRequirements = { requests: { cpu: '1m' } };
		expect(resourcesMatch({ resources: live }, configWith({ cpuRequest: '1e-3' }))).toBe(true);
	});

	test('an explicitly signed exponent matches the expanded form', () => {
		const live: V1ResourceRequirements = { limits: { memory: '1000' } };
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1e+3' }))).toBe(true);
	});

	// `E` is both the exa suffix and an exponent marker; only a following integer makes it an exponent.
	test('uppercase E reads as an exponent with digits and as the exa suffix without', () => {
		const live: V1ResourceRequirements = { limits: { memory: '1000' } };
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1E3' }))).toBe(true);
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1E' }))).toBe(false);
	});

	test('differing decimal-form quantities stay a mismatch', () => {
		const live: V1ResourceRequirements = { requests: { cpu: '600m' } };
		expect(resourcesMatch({ resources: live }, configWith(undefined), { cpuRequest: '.5' })).toBe(false);
	});

	// Kubernetes rejects an exponent stacked on a binary suffix; parsing it anyway would let two
	// strings the API server can never store compare equal and mask a real drift.
	test('an exponent combined with a binary suffix is not compared numerically', () => {
		const live: V1ResourceRequirements = { limits: { memory: '1024000' } };
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1e3Ki' }))).toBe(false);
	});

	test('a bare exponent marker is not a quantity', () => {
		const live: V1ResourceRequirements = { limits: { memory: '1000' } };
		expect(resourcesMatch({ resources: live }, configWith({ memoryLimit: '1e' }))).toBe(false);
	});

	test('an out-of-range exponent falls back to string equality instead of allocating', () => {
		expect(resourcesMatch({ resources: { limits: { memory: '1e999999999' } } }, configWith({ memoryLimit: '1e999999999' }))).toBe(true);
		expect(resourcesMatch({ resources: { limits: { memory: '1' } } }, configWith({ memoryLimit: '1e999999999' }))).toBe(false);
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
