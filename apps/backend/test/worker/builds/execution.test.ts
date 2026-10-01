import { expect, test } from 'bun:test';
import { applyBuildResources, agentAvailable, attemptImageRef } from '~/shared/builds/execution';
import { resolveBuildSettings } from '~/shared/builds/settings';

test('applies the saved resource snapshot to preparation and builder containers', () => {
	const job = { spec: { template: { spec: { initContainers: [{ name: 'prepare' }, { name: 'nixpacks' }], containers: [{ name: 'builder' }] } } } };
	applyBuildResources(job, { ...resolveBuildSettings(null), cpuRequest: '2', cpuLimit: '4', memoryRequest: '4Gi', memoryLimit: '8Gi' });
	for (const container of [...job.spec.template.spec.initContainers, ...job.spec.template.spec.containers]) {
		expect((container as { resources?: unknown }).resources).toEqual({ requests: { cpu: '2', memory: '4Gi' }, limits: { cpu: '4', memory: '8Gi' } });
	}
});

test('does not dispatch to paused, stale or incompatible agents', () => {
	const agent = {
		paused: false,
		revoked: false,
		protocolVersion: 1,
		architecture: 'amd64',
		lastSeenAt: new Date(),
		capabilities: { dockerReady: true, freeDiskBytes: 10e9 }
	};
	expect(agentAvailable(agent, 'amd64')).toBe(true);
	expect(agentAvailable({ ...agent, paused: true }, 'amd64')).toBe(false);
	expect(agentAvailable({ ...agent, lastSeenAt: new Date(0) }, 'amd64')).toBe(false);
	expect(agentAvailable(agent, 'arm64')).toBe(false);
	expect(agentAvailable({ ...agent, protocolVersion: 2 }, 'amd64')).toBe(false);
});

test('each external attempt pushes to a separate image tag', () => {
	expect(attemptImageRef('registry/env/svc:deployment', 'run', 1)).toBe('registry/env/svc:deployment-run-1');
	expect(attemptImageRef('registry/env/svc:deployment', 'run', 2)).not.toBe(attemptImageRef('registry/env/svc:deployment', 'run', 1));
});
