import { describe, expect, test } from 'bun:test';
import { upcloudUksDescriptor } from '../src/platforms/upcloud/descriptor.js';
import { PLATFORMS } from '../src/lib/platforms.js';

describe('upcloudUksDescriptor', () => {
	test('exposes id, label and description', () => {
		expect(upcloudUksDescriptor.id).toBe('upcloud-uks');
		expect(upcloudUksDescriptor.label).toBe('UpCloud (UKS)');
		expect(upcloudUksDescriptor.description).toBe('UpCloud Managed Kubernetes (UKS)');
	});

	test('build returns a platform without CFKE provider or nodeSelector', async () => {
		const platform = await upcloudUksDescriptor.build({});
		expect(platform.id).toBe('upcloud-uks');
		expect(platform.provider).toBeUndefined();
		expect(platform.nodeSelector).toBeUndefined();
		expect(typeof platform.ensureStorage).toBe('function');
		expect(typeof platform.ensureAutoscaling).toBe('function');
	});

	test('is registered in PLATFORMS', () => {
		const ids = PLATFORMS.map(descriptor => descriptor.id);
		expect(ids).toContain('upcloud-uks');
	});

	test('wires a traefik loadbalancer dependency', async () => {
		const platform = await upcloudUksDescriptor.build({});
		const traefik = platform.dependencies.traefik;
		expect(traefik?.kind).toBe('traefik');
		expect(traefik?.namespace).toBe('traefik');
		const service = traefik?.helmValues?.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		const annotations = service.annotations as Record<string, string>;
		expect(annotations['service.beta.kubernetes.io/upcloud-load-balancer-config']).toBeDefined();
	});
});
