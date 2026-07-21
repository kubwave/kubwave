import { describe, expect, test } from 'bun:test';
import { buildUpcloudTraefikValues } from '../src/platforms/upcloud/traefik-values.js';
import { buildUpgradeValues } from '../src/lib/upgrade-plan.js';
import { resolveDependencyState } from '../src/lib/dependencies.js';

describe('buildUpcloudTraefikValues', () => {
	test('service is a LoadBalancer with UpCloud TCP passthrough config', () => {
		const values = buildUpcloudTraefikValues();
		const service = values.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		const annotations = service.annotations as Record<string, string>;
		expect(annotations).toBeDefined();
		const lbConfig = annotations['service.beta.kubernetes.io/upcloud-load-balancer-config'];
		expect(lbConfig).toBeDefined();
		const config = JSON.parse(lbConfig!);
		expect(config.frontends).toContainEqual({ name: 'web', mode: 'http', port: 80 });
		expect(config.frontends).toContainEqual({ name: 'websecure', mode: 'tcp', port: 443 });
	});

	test('has no nodeSelector', () => {
		const values = buildUpcloudTraefikValues();
		expect(values.nodeSelector).toBeUndefined();
	});

	test('runs 2 replicas with PDB and soft anti-affinity', () => {
		const values = buildUpcloudTraefikValues();
		expect((values.deployment as Record<string, unknown>).replicas).toBe(2);
		expect((values.podDisruptionBudget as Record<string, unknown>).enabled).toBe(true);
		const affinity = values.affinity as Record<string, unknown>;
		expect(affinity.podAntiAffinity).toBeDefined();
	});

	test('upgrade values refresh the UpCloud TCP passthrough annotation even from a stale marker', () => {
		const state = {
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/acme',
			registryHost: '',
			registryMode: 'unconfigured' as const,
			registryInsecure: false,
			registryIngressEnabled: false,
			platformId: 'upcloud-uks',
			ingressClassName: 'traefik',
			ingressControllerNamespace: 'traefik',
			traefikValues: {},
			dependencies: resolveDependencyState({}),
			ha: false
		};
		const values = buildUpgradeValues(state, '0.3.0') as Record<string, unknown>;
		const updateDependencies = ((values.update as Record<string, unknown>)?.dependencies as Record<string, unknown>)?.traefik as Record<
			string,
			unknown
		>;
		const traefikConfig = updateDependencies.values as Record<string, unknown>;
		const annotations = (traefikConfig.service as Record<string, unknown>).annotations as Record<string, string>;
		const lbConfig = annotations['service.beta.kubernetes.io/upcloud-load-balancer-config'];
		expect(lbConfig).toBeDefined();
		const config = JSON.parse(lbConfig!);
		expect(config.frontends).toContainEqual({ name: 'web', mode: 'http', port: 80 });
		expect(config.frontends).toContainEqual({ name: 'websecure', mode: 'tcp', port: 443 });
	});
});
