import { describe, expect, test } from 'bun:test';
import { k3sDescriptor } from '../src/platforms/k3s/descriptor.js';
import { buildK3sTraefikValues } from '../src/platforms/k3s/traefik-values.js';
import { defaultTraefikValuesForPlatform } from '../src/lib/platforms.js';
import { buildProductionValues, dnsPolicyForPlatform } from '../src/lib/helm.js';
import { buildUpgradeValues } from '../src/lib/upgrade-plan.js';
import { resolveDependencyState } from '../src/lib/dependencies.js';

describe('k3sDescriptor', () => {
	test('exposes id, label and description', () => {
		expect(k3sDescriptor.id).toBe('k3s');
		expect(k3sDescriptor.label).toBe('k3s');
		expect(k3sDescriptor.description).toBe('Self-managed k3s cluster (bundled Traefik disabled)');
	});

	test('build returns a platform with a preflight and no provider, nodeSelector or autoscaler', async () => {
		const platform = await k3sDescriptor.build({});
		expect(platform.id).toBe('k3s');
		expect(platform.provider).toBeUndefined();
		expect(platform.nodeSelector).toBeUndefined();
		expect(platform.ensureAutoscaling).toBeUndefined();
		expect(typeof platform.preflight).toBe('function');
		expect(typeof platform.ensureStorage).toBe('function');
	});

	test('wires a CLI-managed traefik in its own namespace', async () => {
		const platform = await k3sDescriptor.build({});
		const traefik = platform.dependencies.traefik;
		expect(traefik?.kind).toBe('traefik');
		expect(traefik?.namespace).toBe('traefik');
		expect(traefik?.ingressClassName).toBe('traefik');
	});
});

describe('buildK3sTraefikValues', () => {
	test('service is a plain LoadBalancer for ServiceLB, without annotations or nodeSelector', () => {
		const values = buildK3sTraefikValues();
		const service = values.service as Record<string, unknown>;
		expect(service.type).toBe('LoadBalancer');
		expect(service.annotations).toBeUndefined();
		expect(values.nodeSelector).toBeUndefined();
	});

	test('upgrades rebuild the k3s defaults', () => {
		expect(defaultTraefikValuesForPlatform('k3s')).toEqual(buildK3sTraefikValues());
	});
});

describe('k3s dns policy', () => {
	test('targets the kube-dns labelled CoreDNS on the k3s service CIDR', () => {
		expect(dnsPolicyForPlatform('k3s')).toEqual({
			namespace: 'kube-system',
			podLabels: { 'k8s-app': 'kube-dns' },
			serviceIp: '10.43.0.10/32'
		});
	});

	test('install values carry it into tenant and build egress policies', async () => {
		const platform = await k3sDescriptor.build({});
		const dependencies = resolveDependencyState({ platformState: platform.dependencies });
		const values = buildProductionValues({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/acme',
			buildRegistry: { mode: 'unconfigured' },
			version: '1.0.0',
			ingressClassName: dependencies.traefik.ingressClassName,
			ingressControllerNamespace: dependencies.traefik.namespace,
			storageClass: 'local-path',
			dependencies,
			ha: false,
			dnsPolicy: dnsPolicyForPlatform('k3s')
		});

		const tenants = values.tenants as { egress: { dnsPodLabels: Record<string, string>; dnsServiceIp: string } };
		expect(tenants.egress.dnsPodLabels).toEqual({ 'k8s-app': 'kube-dns' });
		expect(tenants.egress.dnsServiceIp).toBe('10.43.0.10/32');
		const builds = values.builds as { networkPolicy: { dns: { podLabels: Record<string, string> } } };
		expect(builds.networkPolicy.dns.podLabels).toEqual({ 'k8s-app': 'kube-dns' });
		const workloadIngress = values.workloadIngress as { controllerNamespace: string };
		expect(workloadIngress.controllerNamespace).toBe('traefik');
	});

	test('upgrade values keep the k3s dns policy', async () => {
		const platform = await k3sDescriptor.build({});
		const state = {
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/acme',
			registryHost: '',
			registryMode: 'unconfigured' as const,
			registryInsecure: false,
			registryIngressEnabled: false,
			platformId: 'k3s',
			ingressClassName: 'traefik',
			ingressControllerNamespace: 'traefik',
			traefikValues: {},
			dependencies: resolveDependencyState({ platformState: platform.dependencies }),
			ha: false
		};
		const values = buildUpgradeValues(state, '0.3.0') as { tenants: { egress: { dnsPodLabels: Record<string, string> } } };
		expect(values.tenants.egress.dnsPodLabels).toEqual({ 'k8s-app': 'kube-dns' });
	});
});
