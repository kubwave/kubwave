import { describe, expect, test } from 'bun:test';
import { buildInfomaniakTraefikValues } from '../src/platforms/infomaniak/traefik-values.js';
import { buildUpgradeValues } from '../src/lib/upgrade-plan.js';
import { resolveDependencyState } from '../src/lib/dependencies.js';

describe('buildInfomaniakTraefikValues', () => {
	test('service is a plain LoadBalancer with no annotations', () => {
		const values = buildInfomaniakTraefikValues();
		const service = values.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		expect(service.annotations).toBeUndefined();
	});

	test('has no nodeSelector', () => {
		const values = buildInfomaniakTraefikValues();
		expect(values.nodeSelector).toBeUndefined();
	});

	test('runs 2 replicas with PDB and soft anti-affinity', () => {
		const values = buildInfomaniakTraefikValues();
		expect((values.deployment as Record<string, unknown>).replicas).toBe(2);
		expect((values.podDisruptionBudget as Record<string, unknown>).enabled).toBe(true);
		const affinity = values.affinity as Record<string, unknown>;
		expect(affinity.podAntiAffinity).toBeDefined();
	});

	test('adds the Octavia floating-network annotation when a network id is given', () => {
		const values = buildInfomaniakTraefikValues({ floatingNetworkId: 'net-1234' });
		const annotations = (values.service as Record<string, unknown>).annotations as Record<string, string>;
		expect(annotations['loadbalancer.openstack.org/floating-network-id']).toBe('net-1234');
	});

	test('upgrade values preserve an existing floating-network annotation', () => {
		const state = {
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/acme',
			registryHost: '',
			registryMode: 'unconfigured' as const,
			registryInsecure: false,
			registryIngressEnabled: false,
			platformId: 'infomaniak-pck',
			ingressClassName: 'traefik',
			ingressControllerNamespace: 'traefik',
			traefikValues: {},
			dependencies: resolveDependencyState({
				platformState: {
					traefik: {
						kind: 'traefik',
						namespace: 'traefik',
						releaseName: 'traefik',
						ingressClassName: 'traefik',
						helmValues: buildInfomaniakTraefikValues({ floatingNetworkId: 'net-1234' })
					}
				}
			}),
			ha: false
		};
		const values = buildUpgradeValues(state, '0.3.0') as Record<string, unknown>;
		const updateDependencies = ((values.update as Record<string, unknown>)?.dependencies as Record<string, unknown>)?.traefik as Record<
			string,
			unknown
		>;
		const traefikConfig = updateDependencies.values as Record<string, unknown>;
		const service = traefikConfig.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		const annotations = service.annotations as Record<string, string>;
		expect(annotations['loadbalancer.openstack.org/floating-network-id']).toBe('net-1234');
	});
});
