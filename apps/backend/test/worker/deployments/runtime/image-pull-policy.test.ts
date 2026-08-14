import { describe, expect, test } from 'bun:test';
import type { V1Deployment } from '@kubernetes/client-node';
import type { Deployment, DockerImageServiceConfig } from '@kubwave/db';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'ghcr.io/acme/app:next';
const deployment = { serviceId: SERVICE_ID } as Deployment;

function config(): DockerImageServiceConfig {
	return { image: 'ghcr.io/acme/app', tag: 'next', containerPort: 80, env: [], secrets: [], domains: [], volumes: [] };
}

function container(mutableTag?: boolean) {
	return buildDeployment(deployment, NAMESPACE, config(), IMAGE_REF, { mutableTag }).spec!.template!.spec!.containers[0]!;
}

describe('buildDeployment imagePullPolicy', () => {
	// The kubelet defaults to IfNotPresent for a non-`latest` tag, which serves whatever layer the node cached the
	// first time it pulled that tag - so a republished tag would boot an arbitrarily old release, silently.
	test('forces Always for a tag the registry can republish', () => {
		expect(container(true).imagePullPolicy).toBe('Always');
	});

	// Digest-pinned docker-image refs, per-deployment build tags and pinned engine versions all pass mutableTag=false.
	test('keeps IfNotPresent for a ref that cannot change under us', () => {
		expect(container(false).imagePullPolicy).toBe('IfNotPresent');
		expect(container(undefined).imagePullPolicy).toBe('IfNotPresent');
	});

	test('rolls a live Deployment that predates the explicit policy', () => {
		const live = buildDeployment(deployment, NAMESPACE, config(), IMAGE_REF, { mutableTag: true }) as V1Deployment;
		delete live.spec!.template!.spec!.containers[0]!.imagePullPolicy;
		expect(deploymentMatchesConfig(live, config(), IMAGE_REF, SERVICE_ID, undefined, undefined, undefined, true)).toBe(false);
	});

	test('accepts a live Deployment that already carries the desired policy', () => {
		const live = buildDeployment(deployment, NAMESPACE, config(), IMAGE_REF, { mutableTag: true }) as V1Deployment;
		expect(deploymentMatchesConfig(live, config(), IMAGE_REF, SERVICE_ID, undefined, undefined, undefined, true)).toBe(true);
	});
});
