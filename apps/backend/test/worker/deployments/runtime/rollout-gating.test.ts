import { describe, expect, test } from 'bun:test';
import type { Deployment, DockerImageServiceConfig } from '@kubwave/db';
import { SERVICE_ROLLOUT_MIN_READY_SECONDS } from '@kubwave/kube';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'nginx:1.27';
const deployment = { serviceId: SERVICE_ID } as Deployment;

function config(): DockerImageServiceConfig {
	return { image: 'nginx', tag: '1.27', containerPort: 80, env: [], secrets: [], domains: [], volumes: [] };
}

describe('rollout success gating', () => {
	// Tenant pods have no readinessProbe, so a container is "ready" the instant it starts. Without a
	// minimum ready window, a pod that OOMs a second later still flips readyReplicas to 1, and a
	// reconcile tick landing in that window finalizes a crash-looping service as succeeded.
	test('requires a pod to stay ready before it counts as available', () => {
		const spec = buildDeployment(deployment, NAMESPACE, config(), IMAGE_REF).spec!;
		expect(spec.minReadySeconds).toBe(SERVICE_ROLLOUT_MIN_READY_SECONDS);
	});

	test('the window is long enough to outlast an instant crash loop', () => {
		expect(SERVICE_ROLLOUT_MIN_READY_SECONDS).toBeGreaterThanOrEqual(10);
	});

	test('a freshly built Deployment matches its own config', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF);
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID)).toBe(true);
	});

	test('a Deployment without the ready window is a mismatch, so it rolls once', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF);
		delete built.spec!.minReadySeconds;
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID)).toBe(false);
	});
});
