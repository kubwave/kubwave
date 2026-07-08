import { describe, expect, test } from 'bun:test';
import { buildTraefikHelmValues } from '../src/lib/traefik.js';
import { buildSharedTraefikValues } from '../src/platforms/cloudfleet/traefik-values.js';

describe('buildSharedTraefikValues', () => {
	test('sets HA defaults without a nodeSelector', () => {
		const values = buildSharedTraefikValues({});
		expect((values.deployment as Record<string, unknown>).replicas).toBe(2);
		expect(values.nodeSelector).toBeUndefined();
		expect((values.service as Record<string, unknown>).type).toBe('LoadBalancer');
	});
});

describe('buildTraefikHelmValues', () => {
	test('sets resource requests so CFKE can size nodes for the ingress controller', () => {
		const values = buildTraefikHelmValues() as { resources?: { requests?: Record<string, string> } };
		expect(values.resources?.requests).toEqual({ cpu: '100m', memory: '128Mi' });
	});

	test('operator helmValues still override the base', () => {
		const values = buildTraefikHelmValues({
			kind: 'traefik',
			namespace: 'traefik',
			releaseName: 'traefik',
			ingressClassName: 'traefik',
			helmValues: { resources: { requests: { cpu: '200m', memory: '256Mi' } } }
		}) as { resources?: { requests?: Record<string, string> } };
		expect(values.resources?.requests).toEqual({ cpu: '200m', memory: '256Mi' });
	});
});
