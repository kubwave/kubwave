import { describe, expect, test } from 'bun:test';
import type { V1Probe } from '@kubernetes/client-node';
import type { DockerImageServiceConfig } from '@kubwave/db';
import { probesMatch } from '~/modules/worker/jobs/deployments/deployers/runtime/probes';

function configWith(healthCheck: DockerImageServiceConfig['healthCheck']): DockerImageServiceConfig {
	return { image: 'nginx', tag: 'latest', containerPort: 8080, env: [], domains: [], volumes: [], healthCheck };
}

// The API server defaults httpGet.scheme to "HTTP" and fills in every numeric probe field; probesMatch
// must treat that readback as equal, else the reconciler re-writes the Deployment on every tick.
describe('probesMatch tolerates server-defaulted probe fields', () => {
	test('http probe with server-defaulted scheme matches desired config', () => {
		const serverHttpGet = { path: '/health', port: 8080, scheme: 'HTTP' };
		const liveness: V1Probe = {
			httpGet: serverHttpGet,
			initialDelaySeconds: 0,
			periodSeconds: 10,
			timeoutSeconds: 3,
			failureThreshold: 3,
			successThreshold: 1
		};
		const container = { livenessProbe: liveness, readinessProbe: { ...structuredClone(liveness) } };
		const config = configWith({ enabled: true, type: 'http', path: '/health', port: 8080 });
		expect(probesMatch(container, config)).toBe(true);
	});

	test('tcp probe readback matches desired config', () => {
		const liveness: V1Probe = {
			tcpSocket: { port: 8080 },
			initialDelaySeconds: 0,
			periodSeconds: 10,
			timeoutSeconds: 3,
			failureThreshold: 3,
			successThreshold: 1
		};
		const container = { livenessProbe: liveness, readinessProbe: { ...structuredClone(liveness) } };
		const config = configWith({ enabled: true, type: 'tcp', port: 8080 });
		expect(probesMatch(container, config)).toBe(true);
	});

	test('genuinely different http path is still a mismatch', () => {
		const liveness: V1Probe = { httpGet: { path: '/old', port: 8080, scheme: 'HTTP' } };
		const container = { livenessProbe: liveness, readinessProbe: { ...structuredClone(liveness) } };
		const config = configWith({ enabled: true, type: 'http', path: '/new', port: 8080 });
		expect(probesMatch(container, config)).toBe(false);
	});

	test('no probe configured matches a container with no probes', () => {
		expect(probesMatch({}, configWith(undefined))).toBe(true);
	});
});
