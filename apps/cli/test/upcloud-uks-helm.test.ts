import { describe, expect, test } from 'bun:test';
import { buildProductionValues, dnsPolicyForPlatform } from '../src/lib/helm.js';
import { upcloudUksDescriptor } from '../src/platforms/upcloud/descriptor.js';
import { UPCLOUD_DEFAULT_STORAGE_CLASS } from '../src/platforms/upcloud/storage.js';
import { resolveDependencyState } from '../src/lib/dependencies.js';

describe('upcloud-uks helm values', () => {
	test('buildProductionValues omits nodeSelector and sets UKS storage class', async () => {
		const platform = await upcloudUksDescriptor.build({});
		const dependencies = resolveDependencyState({ platformState: platform.dependencies });
		const values = buildProductionValues({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/acme',
			buildRegistry: { mode: 'unconfigured' },
			version: '1.0.0',
			ingressClassName: dependencies.traefik.ingressClassName,
			ingressControllerNamespace: dependencies.traefik.namespace,
			storageClass: UPCLOUD_DEFAULT_STORAGE_CLASS,
			dependencies,
			ha: false
		});

		expect(values.api).not.toHaveProperty('nodeSelector');
		expect(values.console).not.toHaveProperty('nodeSelector');
		expect(values.worker).not.toHaveProperty('nodeSelector');
		expect(values.postgres).toMatchObject({
			storage: { storageClassName: UPCLOUD_DEFAULT_STORAGE_CLASS }
		});
	});

	test('dnsPolicyForPlatform selects coredns for upcloud-uks and every other platform', () => {
		expect(dnsPolicyForPlatform('upcloud-uks').podLabels).toEqual({ 'k8s-app': 'coredns' });
		expect(dnsPolicyForPlatform('cloudfleet-hetzner').podLabels).toEqual({ 'k8s-app': 'coredns' });
		expect(dnsPolicyForPlatform(undefined).podLabels).toEqual({ 'k8s-app': 'coredns' });
	});

	test('buildProductionValues emits the coredns egress policy for upcloud-uks', async () => {
		const platform = await upcloudUksDescriptor.build({});
		const dependencies = resolveDependencyState({ platformState: platform.dependencies });
		const values = buildProductionValues({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/acme',
			buildRegistry: { mode: 'unconfigured' },
			version: '1.0.0',
			ingressClassName: dependencies.traefik.ingressClassName,
			ingressControllerNamespace: dependencies.traefik.namespace,
			storageClass: UPCLOUD_DEFAULT_STORAGE_CLASS,
			dependencies,
			ha: false,
			dnsPolicy: dnsPolicyForPlatform('upcloud-uks')
		});

		const tenants = values.tenants as { egress: { dnsPodLabels: Record<string, string> } };
		expect(tenants.egress.dnsPodLabels).toEqual({ 'k8s-app': 'coredns' });
		const builds = values.builds as { networkPolicy: { dns: { podLabels: Record<string, string> } } };
		expect(builds.networkPolicy.dns.podLabels).toEqual({ 'k8s-app': 'coredns' });
	});
});
