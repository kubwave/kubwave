import { describe, expect, test } from 'bun:test';
import { buildTraefikHelmValues } from '../src/lib/traefik.js';
import { buildSharedTraefikValues } from '../src/platforms/cloudfleet/traefik-values.js';

function traefikConfig(helmValues: Record<string, unknown>) {
	return { kind: 'traefik' as const, namespace: 'traefik', releaseName: 'traefik', ingressClassName: 'traefik', helmValues };
}

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

	test('exposes the public TCP pool as Traefik entrypoints (tcp-30100…tcp-30119)', () => {
		const values = buildTraefikHelmValues() as { ports?: Record<string, unknown> };
		expect(Object.keys(values.ports ?? {})).toHaveLength(20);
		expect(values.ports?.['tcp-30100']).toEqual({ port: 30100, expose: { default: true }, exposedPort: 30100, protocol: 'TCP' });
		expect(values.ports?.['tcp-30119']).toEqual({ port: 30119, expose: { default: true }, exposedPort: 30119, protocol: 'TCP' });
	});

	test('platform helmValues merge on top without dropping the TCP pool', () => {
		const values = buildTraefikHelmValues(traefikConfig(buildSharedTraefikValues({}))) as {
			ports?: Record<string, unknown>;
			service?: Record<string, unknown>;
		};
		expect(values.service?.type).toBe('LoadBalancer');
		expect(Object.keys(values.ports ?? {})).toHaveLength(20);
	});

	test('operator helmValues still override the base', () => {
		const values = buildTraefikHelmValues(traefikConfig({ resources: { requests: { cpu: '200m', memory: '256Mi' } } })) as {
			resources?: { requests?: Record<string, string> };
		};
		expect(values.resources?.requests).toEqual({ cpu: '200m', memory: '256Mi' });
	});
});
