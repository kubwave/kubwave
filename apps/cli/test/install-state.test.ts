import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AppsV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import * as realHelm from '../src/lib/helm.js';
import type { KubeConfig } from '@kubernetes/client-node';
import { resolveDependencyState } from '../src/lib/dependencies.js';

let helmValues: Record<string, unknown> = {};
let rawHelmValuesStdout: string | undefined;
const execHelmCalls: string[][] = [];

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	execHelm: async (args: string[]) => {
		execHelmCalls.push(args);
		return { stdout: rawHelmValuesStdout ?? JSON.stringify(helmValues), stderr: '', exitCode: 0 };
	}
}));

const { resolveInstallState, encodeInstallStateData, decodeInstallStateData, buildInstallState, imageRegistryFromRepository } =
	await import('../src/lib/install-state.js');
const { buildUpgradeValues } = await import('../src/lib/upgrade-plan.js');

afterEach(() => {
	helmValues = {};
	rawHelmValuesStdout = undefined;
	execHelmCalls.length = 0;
});

describe('install state resolution', () => {
	test('derives legacy state from live ingress and workload images when Helm values are missing', async () => {
		const state = await resolveInstallState(
			kubeConfig({
				networkingApi: {
					readNamespacedIngress: async () => ({
						metadata: {
							annotations: { 'cert-manager.io/cluster-issuer': 'corp-private-ca' }
						},
						spec: {
							ingressClassName: 'custom-traefik',
							rules: [{ host: 'live.example.com' }]
						}
					})
				},
				appsApi: {
					readNamespacedDeployment: async ({ name }: { name: string }) => ({
						spec: {
							template: {
								spec: {
									containers: [{ name, image: `registry.internal:5000/acme/${name}:0.1.0` }]
								}
							}
						}
					})
				}
			})
		);

		expect(execHelmCalls[0]).toEqual(['get', 'values', 'kubwave', '-n', 'kubwave', '-o', 'json', '--all']);
		expect(state).toMatchObject({
			domain: 'live.example.com',
			imageRegistry: 'registry.internal:5000/acme',
			registryHost: 'registry.live.example.com',
			ingressClassName: 'custom-traefik',
			clusterIssuerName: 'corp-private-ca'
		});
	});

	test('uses an explicit registry override when old releases do not expose image repositories', async () => {
		helmValues = { ingress: { host: 'app.example.com' } };

		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'registry.example.com/kubwave' });

		expect(state.imageRegistry).toBe('registry.example.com/kubwave');
		expect(state.registryHost).toBe('registry.app.example.com');
	});

	test('falls back to live data when helm values are invalid JSON', async () => {
		rawHelmValuesStdout = '{not-json';

		const state = await resolveInstallState(
			kubeConfig({
				networkingApi: {
					readNamespacedIngress: async () => ({
						spec: { rules: [{ host: 'live.example.com' }] }
					})
				},
				appsApi: {
					readNamespacedDeployment: async ({ name }: { name: string }) => ({
						spec: { template: { spec: { containers: [{ name, image: `registry.example.com/acme/${name}:1.0.0` }] } } }
					})
				}
			})
		);

		expect(state.domain).toBe('live.example.com');
		expect(state.imageRegistry).toBe('registry.example.com/acme');
	});

	test('ignores invalid APP_BASE_URL and uses the live ingress host', async () => {
		helmValues = {
			api: {
				env: { APP_BASE_URL: 'not a valid url' },
				image: { repository: 'registry.example.com/acme/api' }
			}
		};

		const state = await resolveInstallState(
			kubeConfig({
				networkingApi: {
					readNamespacedIngress: async () => ({
						spec: { rules: [{ host: 'live.example.com' }] }
					})
				}
			})
		);

		expect(state.domain).toBe('live.example.com');
		expect(state.imageRegistry).toBe('registry.example.com/acme');
	});

	test('fails clearly when the image registry cannot be derived', async () => {
		helmValues = { ingress: { host: 'app.example.com' } };

		await expect(resolveInstallState(kubeConfig())).rejects.toThrow('Cannot determine installed image registry');
	});

	test('derives legacy internal platform registry settings from release values', async () => {
		helmValues = {
			ingress: { host: 'app.example.com' },
			api: { image: { repository: 'ghcr.io/test/backend' } },
			registry: { enabled: true, ingress: { enabled: false } },
			builds: { registry: { endpoint: 'kubwave-registry.kubwave.svc.cluster.local:5000', insecure: true } }
		};

		const state = await resolveInstallState(kubeConfig());

		expect(state.registryMode).toBe('platform');
		expect(state.registryHost).toBe('kubwave-registry.kubwave.svc.cluster.local:5000');
		expect(state.registryIngressEnabled).toBe(false);
		expect(state.registryInsecure).toBe(true);
	});
});

describe('ha persistence', () => {
	test('decodeInstallStateData ignores malformed JSON fields', () => {
		expect(
			decodeInstallStateData({
				domain: 'app.example.com',
				node_selector_json: '{broken',
				traefik_values_json: '{also-broken'
			})
		).toEqual({ domain: 'app.example.com' });
	});

	test('round-trips ha through the marker encode/decode', () => {
		expect(encodeInstallStateData({ ha: true })).toMatchObject({ ha_enabled: 'true' });
		expect(encodeInstallStateData({ ha: false })).toMatchObject({ ha_enabled: 'false' });
		expect(decodeInstallStateData({ ha_enabled: 'true' })).toMatchObject({ ha: true });
		expect(decodeInstallStateData({ ha_enabled: 'false' })).toMatchObject({ ha: false });
	});

	test('round-trips the tenant Pod Security level through the marker encode/decode', () => {
		expect(encodeInstallStateData({ tenantPodSecurity: 'restricted' })).toMatchObject({ tenant_pod_security: 'restricted' });
		expect(decodeInstallStateData({ tenant_pod_security: 'restricted' })).toMatchObject({ tenantPodSecurity: 'restricted' });
		// 'off' persists as an empty string (PSS labels disabled), not dropped.
		expect(encodeInstallStateData({ tenantPodSecurity: '' })).toMatchObject({ tenant_pod_security: '' });
		expect(decodeInstallStateData({ tenant_pod_security: '' })).toMatchObject({ tenantPodSecurity: '' });
	});

	test('round-trips tenant_runtime_class through the marker encode/decode', () => {
		expect(encodeInstallStateData({ tenantRuntimeClass: 'gvisor' })).toMatchObject({ tenant_runtime_class: 'gvisor' });
		expect(decodeInstallStateData({ tenant_runtime_class: 'gvisor' })).toMatchObject({ tenantRuntimeClass: 'gvisor' });
		// 'off' persists as an empty string (runtime class cleared), not dropped.
		expect(encodeInstallStateData({ tenantRuntimeClass: '' })).toMatchObject({ tenant_runtime_class: '' });
		expect(decodeInstallStateData({ tenant_runtime_class: '' })).toMatchObject({ tenantRuntimeClass: '' });
	});

	test('resolveInstallState reads ha from the live release values', async () => {
		helmValues = { ingress: { host: 'app.example.com' }, ha: { enabled: true } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app' });
		expect(state.ha).toBe(true);
	});

	test('resolveInstallState defaults ha to false when neither marker nor values set it', async () => {
		helmValues = { ingress: { host: 'app.example.com' } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app' });
		expect(state.ha).toBe(false);
	});

	test('marker ha wins over the live release values (the worker mirrors the admin toggle there)', async () => {
		helmValues = { ingress: { host: 'app.example.com' }, ha: { enabled: false } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app', markerState: { ha: true } });
		expect(state.ha).toBe(true);
	});

	test('resolveInstallState reads tenantPodSecurity back from the live release values (so upgrades preserve it)', async () => {
		helmValues = { ingress: { host: 'app.example.com' }, tenants: { podSecurity: 'restricted' } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app' });
		expect(state.tenantPodSecurity).toBe('restricted');
	});

	test('marker tenantPodSecurity wins and preserves the off level the live values cannot express', async () => {
		helmValues = { ingress: { host: 'app.example.com' }, tenants: { podSecurity: 'baseline' } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app', markerState: { tenantPodSecurity: '' } });
		expect(state.tenantPodSecurity).toBe('');
	});

	test('resolveInstallState reads tenantRuntimeClass back from the live release values (so upgrades preserve it)', async () => {
		helmValues = { ingress: { host: 'app.example.com' }, tenants: { runtimeClass: { default: 'gvisor' } } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app' });
		expect(state.tenantRuntimeClass).toBe('gvisor');
	});

	test('marker tenantRuntimeClass wins and preserves the off level the live values cannot express', async () => {
		helmValues = { ingress: { host: 'app.example.com' }, tenants: { runtimeClass: { default: 'gvisor' } } };
		const state = await resolveInstallState(kubeConfig(), { registryOverride: 'r.example.com/app', markerState: { tenantRuntimeClass: '' } });
		expect(state.tenantRuntimeClass).toBe('');
	});

	test('fails when no domain can be derived from any source', async () => {
		helmValues = {};
		const kc = kubeConfig();
		await expect(resolveInstallState(kc, { registryOverride: 'r.example.com/app' })).rejects.toThrow('Cannot determine installed platform domain');
	});
});

describe('buildInstallState', () => {
	test('builds install state from config', () => {
		const state = buildInstallState({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/test/kubwave',
			namespace: 'kubwave'
		} as never);
		expect(state.domain).toBe('app.example.com');
		expect(state.imageRegistry).toBe('ghcr.io/test/kubwave');
		expect(state.registryMode).toBe('unconfigured');
		expect(state.registryHost).toBe('');
		expect(state.ha).toBeUndefined();
	});

	test('builds install state with HA enabled', () => {
		const state = buildInstallState({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			ha: true
		} as never);
		expect(state.ha).toBe(true);
	});

	test('builds install state with node selector', () => {
		const state = buildInstallState({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		} as never);
		expect(state.nodeSelector).toEqual({ 'cfke.io/provider': 'hetzner' });
	});

	test('builds install state with empty node selector omitted', () => {
		const state = buildInstallState({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			nodeSelector: {}
		} as never);
		expect(state.nodeSelector).toBeUndefined();
	});

	test('builds install state with storage class', () => {
		const state = buildInstallState({
			domain: 'app.example.com',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			storageClass: 'hcloud-volumes'
		} as never);
		expect(state.storageClass).toBe('hcloud-volumes');
	});
});

test('external install persists its endpoint and preserves it through upgrade', () => {
	const config = {
		domain: 'app.example.com',
		imageRegistry: 'ghcr.io/test',
		namespace: 'kubwave',
		buildRegistry: { mode: 'external', endpoint: 'ghcr.io/kubwave', insecure: true }
	};
	const state = buildInstallState(config as never, 'cloudfleet-hetzner');
	expect(state.registryHost).toBe('ghcr.io/kubwave');
	expect(state.registryMode).toBe('external');
	expect(state.registryInsecure).toBe(true);
	const values = buildUpgradeValues(state, '0.3.0') as {
		registry: Record<string, unknown>;
		builds: { registry: { endpoint: string; insecure: boolean } };
	};
	expect(values.registry).toEqual({ enabled: false });
	expect(values.builds.registry.endpoint).toBe('ghcr.io/kubwave');
	expect(values.builds.registry.insecure).toBe(true);
});

describe('imageRegistryFromRepository', () => {
	test('extracts registry from workload-suffixed repository', () => {
		expect(imageRegistryFromRepository('ghcr.io/test/kubwave/backend', 'api')).toBe('ghcr.io/test/kubwave');
	});

	test('extracts registry using lastIndexOf fallback', () => {
		expect(imageRegistryFromRepository('ghcr.io/test/kubwave', 'api')).toBe('ghcr.io/test');
	});

	test('returns undefined for single-segment repository', () => {
		expect(imageRegistryFromRepository('api', 'api')).toBeUndefined();
	});

	test('returns undefined for missing repository', () => {
		expect(imageRegistryFromRepository(undefined, 'api')).toBeUndefined();
	});
});

test('registry_mode round-trips through marker encode/decode', () => {
	for (const mode of ['platform', 'external'] as const) {
		const encoded = encodeInstallStateData({ registryMode: mode });
		expect(encoded['registry_mode']).toBe(mode);
		expect(decodeInstallStateData(encoded)?.registryMode).toBe(mode);
	}
});

test('registry trust details round-trip through marker encode/decode', () => {
	const encoded = encodeInstallStateData({
		registryInsecure: true,
		registryIngressEnabled: false,
		registryClusterIssuer: 'corp-private-ca',
		clusterIssuerName: 'corp-private-ca'
	});
	expect(encoded).toMatchObject({
		registry_insecure: 'true',
		registry_ingress_enabled: 'false',
		registry_cluster_issuer: 'corp-private-ca',
		cluster_issuer_name: 'corp-private-ca'
	});
	expect(decodeInstallStateData(encoded)).toMatchObject({
		registryInsecure: true,
		registryIngressEnabled: false,
		registryClusterIssuer: 'corp-private-ca',
		clusterIssuerName: 'corp-private-ca'
	});
});

test('unknown registry_mode marker values are ignored', () => {
	expect(decodeInstallStateData({ registry_mode: 'internal-http' })?.registryMode).toBeUndefined();
});

test('buildUpgradeValues emits the platform TLS registry', () => {
	const state = {
		domain: 'app.example.com',
		imageRegistry: 'ghcr.io/acme',
		registryHost: 'registry.app.example.com',
		registryMode: 'platform' as const,
		registryInsecure: false,
		registryIngressEnabled: true,
		registryClusterIssuer: 'corp-private-ca',
		clusterIssuerName: 'corp-private-ca',
		platformId: 'cloudfleet-hetzner',
		ingressClassName: 'traefik',
		ingressControllerNamespace: 'traefik',
		traefikValues: {},
		dependencies: resolveDependencyState({}),
		ha: false
	};
	const values = buildUpgradeValues(state, '0.3.0') as {
		registry: { ingress: { enabled: boolean; host: string; clusterIssuer: string }; auth: { htpasswdSecretName: string } };
		builds: { registry: { endpoint: string; insecure: boolean; pushSecretName: string; pullSecretName: string } };
	};
	expect(values.registry.ingress).toMatchObject({ enabled: true, host: 'registry.app.example.com', clusterIssuer: 'corp-private-ca' });
	expect(values.registry.auth.htpasswdSecretName).toBe('registry-htpasswd');
	expect(values.builds.registry).toMatchObject({
		endpoint: 'registry.app.example.com',
		insecure: false,
		pushSecretName: 'registry-creds',
		pullSecretName: 'kubwave-registry-pull'
	});
});

test('buildUpgradeValues preserves a legacy internal platform registry without enabling ingress', () => {
	const state = {
		domain: 'app.example.com',
		imageRegistry: 'ghcr.io/acme',
		registryHost: 'kubwave-registry.kubwave.svc.cluster.local:5000',
		registryMode: 'platform' as const,
		registryInsecure: true,
		registryIngressEnabled: false,
		platformId: 'cloudfleet-hetzner',
		ingressClassName: 'traefik',
		ingressControllerNamespace: 'traefik',
		traefikValues: {},
		dependencies: resolveDependencyState({}),
		ha: false
	};
	const values = buildUpgradeValues(state, '0.3.0') as {
		registry: { ingress: { enabled: boolean }; auth?: { htpasswdSecretName: string } };
		builds: { registry: { endpoint: string; insecure: boolean; pushSecretName: string; pullSecretName: string } };
	};
	expect(values.registry.ingress).toEqual({ enabled: false });
	expect(values.registry.auth).toBeUndefined();
	expect(values.builds.registry).toEqual({
		endpoint: 'kubwave-registry.kubwave.svc.cluster.local:5000',
		insecure: true,
		pushSecretName: '',
		pullSecretName: ''
	});
});

function kubeConfig(apis: { networkingApi?: unknown; appsApi?: unknown } = {}): KubeConfig {
	return {
		makeApiClient(apiClass: unknown) {
			if (apiClass === NetworkingV1Api) return apis.networkingApi ?? notFoundApi('readNamespacedIngress');
			if (apiClass === AppsV1Api) return apis.appsApi ?? notFoundApi('readNamespacedDeployment');
			throw new Error('unexpected api client');
		}
	} as KubeConfig;
}

function notFoundApi(method: string): Record<string, () => Promise<never>> {
	return {
		[method]: async () => {
			throw { code: 404 };
		}
	};
}
