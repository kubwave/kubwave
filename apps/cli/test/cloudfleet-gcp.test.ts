import { describe, expect, test } from 'bun:test';
import { cloudfleetGcpDescriptor } from '../src/platforms/cloudfleet/gcp/descriptor.js';

describe('cloudfleetGcpDescriptor', () => {
	test('exposes id, label and description', () => {
		expect(cloudfleetGcpDescriptor.id).toBe('cloudfleet-gcp');
		expect(cloudfleetGcpDescriptor.label).toBe('Cloudfleet (Google Cloud)');
		expect(cloudfleetGcpDescriptor.description).toBe('Cloudfleet-managed Kubernetes auf Google Cloud');
	});

	test('build returns a gcp platform without prompting', async () => {
		const platform = await cloudfleetGcpDescriptor.build({});
		expect(platform.id).toBe('cloudfleet-gcp');
		expect(platform.provider).toBe('gcp');
		expect(platform.nodeSelector).toEqual({ 'cfke.io/provider': 'gcp' });
		expect(typeof platform.ensureStorage).toBe('function');
	});

	test('wires a gcp traefik loadbalancer dependency', async () => {
		const platform = await cloudfleetGcpDescriptor.build({});
		const traefik = platform.dependencies.traefik;
		expect(traefik?.kind).toBe('traefik');
		expect(traefik?.namespace).toBe('traefik');
		const service = traefik?.helmValues?.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		expect(service.annotations).toBeUndefined();
	});
});
