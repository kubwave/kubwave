import { describe, expect, test } from 'bun:test';
import { k3sDescriptor } from '../src/platforms/k3s/descriptor.js';
import { buildK3sTraefikValues } from '../src/platforms/k3s/traefik-values.js';
import { defaultTraefikValuesForPlatform } from '../src/lib/platforms.js';
import { buildProductionValues, buildValues, dnsPolicyForPlatform } from '../src/lib/helm.js';
import { buildUpgradeValues } from '../src/lib/upgrade-plan.js';
import { resolveDependencyState } from '../src/lib/dependencies.js';
import { buildInstallState, decodeInstallStateData, encodeInstallStateData } from '../src/lib/install-state.js';

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
		expect(typeof platform.resolveDnsPolicy).toBe('function');
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

	test('upgrade values fall back to the static k3s dns policy', async () => {
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

describe('cluster-resolved dns policy', () => {
	const clusterDnsPolicy = { namespace: 'kube-system', podLabels: { 'k8s-app': 'kube-dns' }, serviceIp: '10.100.0.10/32' };
	const installConfig = {
		domain: 'app.example.com',
		email: 'ops@example.com',
		version: '1.0.0',
		imageRegistry: 'ghcr.io/acme',
		namespace: 'kubwave',
		ha: false,
		dnsPolicy: dnsPolicyForPlatform('k3s'),
		clusterDnsPolicy
	};

	test('install values use it over the static platform default', () => {
		const values = buildValues(installConfig) as {
			tenants: { egress: { dnsServiceIp: string } };
			builds: { networkPolicy: { dns: { serviceIp: string } } };
		};
		expect(values.tenants.egress.dnsServiceIp).toBe('10.100.0.10/32');
		expect(values.builds.networkPolicy.dns.serviceIp).toBe('10.100.0.10/32');
	});

	test('round-trips through the marker and drives upgrade values', async () => {
		const platform = await k3sDescriptor.build({});
		const installState = buildInstallState({ ...installConfig, dependencies: platform.dependencies }, 'k3s');
		const data = encodeInstallStateData(installState);
		expect(JSON.parse(data['cluster_dns_policy_json'] ?? '{}')).toEqual(clusterDnsPolicy);

		const decoded = decodeInstallStateData(data);
		expect(decoded?.clusterDnsPolicy).toEqual(clusterDnsPolicy);

		const values = buildUpgradeValues({ ...installState, ...decoded }, '0.3.0') as {
			tenants: { egress: { dnsServiceIp: string } };
			builds: { networkPolicy: { dns: { serviceIp: string } } };
		};
		expect(values.tenants.egress.dnsServiceIp).toBe('10.100.0.10/32');
		expect(values.builds.networkPolicy.dns.serviceIp).toBe('10.100.0.10/32');
	});

	test('is not persisted when the platform did not read it from the cluster', () => {
		const { clusterDnsPolicy: _omitted, ...config } = installConfig;
		expect(encodeInstallStateData(buildInstallState(config, 'k3s'))).not.toHaveProperty('cluster_dns_policy_json');
	});

	test('a malformed marker value is ignored', () => {
		expect(decodeInstallStateData({ cluster_dns_policy_json: '{"namespace":"kube-system"}' })?.clusterDnsPolicy).toBeUndefined();
	});
});
