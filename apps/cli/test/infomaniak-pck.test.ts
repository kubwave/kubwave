import { describe, expect, test } from 'bun:test';
import { infomaniakPckDescriptor } from '../src/platforms/infomaniak/descriptor.js';
import { PLATFORMS } from '../src/lib/platforms.js';

describe('infomaniakPckDescriptor', () => {
	test('exposes id, label and description', () => {
		expect(infomaniakPckDescriptor.id).toBe('infomaniak-pck');
		expect(infomaniakPckDescriptor.label).toBe('Infomaniak (PCK)');
		expect(infomaniakPckDescriptor.description).toBe('Infomaniak Public Cloud Kubernetes (PCK)');
	});

	test('build returns a platform without CFKE provider or nodeSelector', async () => {
		const platform = await infomaniakPckDescriptor.build({});
		expect(platform.id).toBe('infomaniak-pck');
		expect(platform.provider).toBeUndefined();
		expect(platform.nodeSelector).toBeUndefined();
		expect(typeof platform.ensureStorage).toBe('function');
	});

	test('does not install a cluster autoscaler', async () => {
		const platform = await infomaniakPckDescriptor.build({});
		expect(platform.ensureAutoscaling).toBeUndefined();
	});

	test('is registered in PLATFORMS', () => {
		const ids = PLATFORMS.map(descriptor => descriptor.id);
		expect(ids).toContain('infomaniak-pck');
	});

	test('wires a traefik loadbalancer dependency', async () => {
		const platform = await infomaniakPckDescriptor.build({});
		const traefik = platform.dependencies.traefik;
		expect(traefik?.kind).toBe('traefik');
		expect(traefik?.namespace).toBe('traefik');
		const service = traefik?.helmValues?.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
	});

	test('passes the floating network id through to the traefik service annotation', async () => {
		const platform = await infomaniakPckDescriptor.build({ infomaniakFloatingNetworkId: 'net-1234' });
		const service = platform.dependencies.traefik?.helmValues?.service as Record<string, unknown>;
		const annotations = service.annotations as Record<string, string>;
		expect(annotations['loadbalancer.openstack.org/floating-network-id']).toBe('net-1234');
	});
});
