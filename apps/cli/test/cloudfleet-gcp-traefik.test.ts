import { describe, expect, test } from 'bun:test';
import { buildGcpTraefikValues } from '../src/platforms/cloudfleet/gcp/traefik-overrides.js';

describe('buildGcpTraefikValues', () => {
	test('service is a LoadBalancer without annotations', () => {
		const values = buildGcpTraefikValues();
		const service = values.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		expect(service.annotations).toBeUndefined();
	});

	test('targets gcp nodes and runs 2 replicas', () => {
		const values = buildGcpTraefikValues();
		expect(values.nodeSelector).toEqual({ 'cfke.io/provider': 'gcp' });
		expect((values.deployment as Record<string, unknown>).replicas).toBe(2);
	});

	test('sets a pod disruption budget and soft anti-affinity', () => {
		const values = buildGcpTraefikValues();
		expect((values.podDisruptionBudget as Record<string, unknown>).enabled).toBe(true);
		const affinity = values.affinity as Record<string, unknown>;
		expect(affinity.podAntiAffinity).toBeDefined();
	});
});
