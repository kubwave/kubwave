import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import { buildValues, generateValuesYaml } from '../src/lib/helm.js';
import type { InstallConfig } from '../src/lib/helm.js';
import { cloudfleetHetznerDescriptor } from '../src/platforms/cloudfleet/hetzner/descriptor.js';
import { buildHetznerTraefikValues } from '../src/platforms/cloudfleet/hetzner/traefik-overrides.js';

const config: InstallConfig = {
	domain: 'app.example.com',
	email: 'ops@example.com',
	version: '0.2.0',
	imageRegistry: 'ghcr.io/acme',
	namespace: 'kubwave',
	ha: false,
	storageClass: 'fast-sc',
	nodeSelector: { 'cfke.io/provider': 'hetzner' },
	dependencies: {
		traefik: {
			kind: 'traefik',
			namespace: 'traefik',
			releaseName: 'traefik',
			ingressClassName: 'traefik',
			helmValues: {
				deployment: { replicas: 2 },
				podDisruptionBudget: { enabled: true, minAvailable: 1 },
				service: { type: 'LoadBalancer' },
				nodeSelector: { 'cfke.io/provider': 'hetzner' }
			}
		}
	}
};

describe('helm values generation', () => {
	test('builds Hetzner Traefik HA provider values', () => {
		expect(buildHetznerTraefikValues({ lbLocation: 'fsn1' })).toEqual({
			deployment: { replicas: 2 },
			podDisruptionBudget: { enabled: true, minAvailable: 1 },
			affinity: {
				podAntiAffinity: {
					preferredDuringSchedulingIgnoredDuringExecution: [
						{
							weight: 100,
							podAffinityTerm: {
								topologyKey: 'kubernetes.io/hostname',
								labelSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } }
							}
						}
					]
				}
			},
			service: {
				type: 'LoadBalancer',
				annotations: { 'load-balancer.hetzner.cloud/location': 'fsn1' }
			},
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		});
	});

	test('Cloudfleet Hetzner platform provides workload placement independent of storage', async () => {
		const platform = await cloudfleetHetznerDescriptor.build({ hetznerLbLocation: 'fsn1' });
		expect(platform.nodeSelector).toEqual({ 'cfke.io/provider': 'hetzner' });
	});

	test('builds values object for the chart contract', () => {
		const values = buildValues(config);
		// api — backend image, adopts the pre-created console-creds Secret (JWT), prod env.
		expect(values.api).toMatchObject({
			serviceAccount: { create: true },
			image: { repository: 'ghcr.io/acme/backend', tag: '0.2.0', pullPolicy: 'IfNotPresent' },
			secret: { create: false, existingSecret: 'console-creds' },
			env: { APP_BASE_URL: 'https://app.example.com', SMTP_HOST: '' },
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		});
		// console — image only; never reads JWT/DB, so it carries no Secret.
		expect(values.console).toMatchObject({
			image: { repository: 'ghcr.io/acme/console', tag: '0.2.0', pullPolicy: 'IfNotPresent' },
			resources: {
				requests: { cpu: '100m', memory: '256Mi' },
				limits: { cpu: '1000m', memory: '1Gi' }
			},
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		});
		expect(values.console).not.toHaveProperty('secret');
		// worker — same backend image + ServiceAccount (read-write RBAC).
		expect(values.worker).toMatchObject({
			serviceAccount: { create: true },
			image: { repository: 'ghcr.io/acme/backend', tag: '0.2.0', pullPolicy: 'IfNotPresent' },
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		});
		expect(values.builds).toMatchObject({
			engine: 'buildkit',
			builderImage: 'moby/buildkit:v0.31.0-rootless',
			buildToolsImage: 'ghcr.io/acme/build-tools:0.2.0'
		});
		expect(values.postgres).toMatchObject({
			storage: { storageClassName: 'fast-sc' },
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		});
		expect(values.update).toMatchObject({
			nodeSelector: { 'cfke.io/provider': 'hetzner' },
			dependencies: {
				mode: 'auto',
				traefik: {
					values: {
						ingressClass: { enabled: true, isDefaultClass: true },
						deployment: { replicas: 2 },
						podDisruptionBudget: { enabled: true, minAvailable: 1 },
						service: { type: 'LoadBalancer' },
						nodeSelector: { 'cfke.io/provider': 'hetzner' }
					}
				}
			}
		});
		expect(values.registry).toEqual({ enabled: false });
		expect((values.builds as { registry: Record<string, unknown> }).registry).toMatchObject({
			endpoint: '',
			insecure: false,
			pushSecretName: '',
			pullSecretName: ''
		});
		expect(values.mailcrab).toEqual({ enabled: false });
		// Dev-only workloads — prod must disable both, else they fall to dev defaults and break the install.
		expect(values.adminer).toEqual({ enabled: false });
		expect(values.docs).toEqual({ enabled: false });
		// Prod always runs CloudNativePG; HA is off unless --ha was passed.
		expect(values.postgres).toMatchObject({ mode: 'cnpg' });
		expect(values.ha).toEqual({ enabled: false, replicas: 3 });
		expect(values.certManager).toEqual({
			clusterIssuer: { name: 'letsencrypt-prod', create: true, email: 'ops@example.com' }
		});
	});

	test('emits ha.enabled = true when --ha is set', () => {
		expect(buildValues({ ...config, ha: true }).ha).toEqual({ enabled: true, replicas: 3 });
		expect(buildValues({ ...config, ha: false }).ha).toEqual({ enabled: false, replicas: 3 });
	});

	test('omits nodeSelector when none is configured', () => {
		const values = buildValues({ ...config, nodeSelector: undefined });
		expect(values.api).not.toHaveProperty('nodeSelector');
		expect(values.console).not.toHaveProperty('nodeSelector');
		expect(values.worker).not.toHaveProperty('nodeSelector');
		expect(values.postgres).not.toHaveProperty('nodeSelector');
		expect(values.update).not.toHaveProperty('nodeSelector');
	});

	test('serializes valid YAML', () => {
		const parsed = parse(generateValuesYaml(config));
		expect(parsed.api.image.repository).toBe('ghcr.io/acme/backend');
		expect(parsed.console.image.repository).toBe('ghcr.io/acme/console');
		expect(parsed.worker.image.repository).toBe('ghcr.io/acme/backend');
		expect(parsed.api.env.APP_BASE_URL).toBe('https://app.example.com');
		expect(parsed.ingress.host).toBe('app.example.com');
		expect(parsed.ingress.annotations['cert-manager.io/cluster-issuer']).toBe('letsencrypt-prod');
		expect(parsed.workloadIngress.clusterIssuer).toBe('letsencrypt-prod');
		expect(parsed.certManager.clusterIssuer.create).toBe(true);
		expect(parsed.certManager.clusterIssuer.name).toBe('letsencrypt-prod');
		expect(parsed.certManager.clusterIssuer.email).toBe('ops@example.com');
	});

	test('can render install values that reuse an existing ClusterIssuer', () => {
		const values = buildValues({
			...config,
			certManagerClusterIssuer: { name: 'letsencrypt-prod', create: false }
		}) as {
			certManager: { clusterIssuer: { name: string; create: boolean; email?: string } };
			ingress: { annotations: Record<string, string> };
			workloadIngress: { clusterIssuer: string };
		};

		expect(values.certManager.clusterIssuer).toEqual({ name: 'letsencrypt-prod', create: false });
		expect(values.certManager.clusterIssuer).not.toHaveProperty('email');
		expect(values.ingress.annotations['cert-manager.io/cluster-issuer']).toBe('letsencrypt-prod');
		expect(values.workloadIngress.clusterIssuer).toBe('letsencrypt-prod');
	});

	test('points the tenant NetworkPolicy at the prod Traefik namespace, not the dev kube-system default', () => {
		// In prod Traefik has its own namespace; the kube-system default would let an enforcing CNI block Traefik → tenant pods, leaving tenant services unreachable.
		const values = buildValues(config) as { workloadIngress: { controllerNamespace: string } };
		expect(values.workloadIngress.controllerNamespace).toBe('traefik');
	});

	test('turns on tenant egress isolation and the builder egress firewall for prod', () => {
		// Cloudfleet enforces NetworkPolicy (Cilium), so prod must enable tenant + build egress confinement; the chart defaults them off (a no-op on dev/flannel).
		const values = buildValues(config) as {
			tenants: { egress: { enabled: boolean; dnsPodLabels?: Record<string, string>; dnsServiceIp?: string } };
			builds: {
				networkPolicy: {
					enabled: boolean;
					dns?: { namespace?: string; podLabels?: Record<string, string>; serviceIp?: string };
					ingressController?: { enabled?: boolean; namespace?: string; ports?: number[] };
				};
			};
		};
		expect(values.tenants.egress.enabled).toBe(true);
		expect(values.tenants.egress.dnsPodLabels).toEqual({ 'k8s-app': 'coredns' });
		expect(values.tenants.egress.dnsServiceIp).toBe('10.96.0.10/32');
		expect(values.builds.networkPolicy.enabled).toBe(true);
		expect(values.builds.networkPolicy.dns).toEqual({
			namespace: 'kube-system',
			podLabels: { 'k8s-app': 'coredns' },
			serviceIp: '10.96.0.10/32'
		});
		expect(values.builds.networkPolicy.ingressController).toBeUndefined();
	});

	test('omits tenants.podSecurity when no level is configured, so the chart default (baseline) applies', () => {
		const values = buildValues(config) as { tenants: Record<string, unknown> };
		// Assert the KEY is absent (not merely undefined) - emitting `podSecurity: undefined` would override the chart default.
		expect('podSecurity' in values.tenants).toBe(false);
	});

	test('emits the configured tenant Pod Security level', () => {
		const restricted = buildValues({ ...config, tenantPodSecurity: 'restricted' }) as { tenants: { podSecurity?: string } };
		expect(restricted.tenants.podSecurity).toBe('restricted');
		const baseline = buildValues({ ...config, tenantPodSecurity: 'baseline' }) as { tenants: { podSecurity?: string } };
		expect(baseline.tenants.podSecurity).toBe('baseline');
	});

	test("emits an empty podSecurity to disable the PSS labels when 'off' was chosen", () => {
		const values = buildValues({ ...config, tenantPodSecurity: '' }) as { tenants: { podSecurity?: string } };
		expect(values.tenants.podSecurity).toBe('');
	});

	test('does not pin the dev k3d ingress IP for prod installs', () => {
		// The chart's 127.0.0.1 default makes auto-domains unreachable (HTTP-01 self-check fails); buildValues() sets '' so the worker auto-detects from the Traefik LB.
		const values = buildValues(config) as { workloadIngress: { loadBalancerIp: string } };
		expect(values.workloadIngress.loadBalancerIp).toBe('');
	});

	test('platform registry mode emits TLS ingress, htpasswd, and builder hairpin egress', () => {
		const values = buildValues({ ...config, buildRegistry: { mode: 'platform' } }) as {
			registry: Record<string, unknown>;
			builds: {
				registry: Record<string, unknown>;
				networkPolicy: {
					ingressController?: {
						enabled?: boolean;
						namespace?: string;
						podLabels?: Record<string, string>;
						ports?: number[];
					};
				};
			};
		};
		expect(values.registry).toMatchObject({
			enabled: true,
			ingress: { enabled: true, host: 'registry.app.example.com', className: 'traefik', clusterIssuer: 'letsencrypt-prod' },
			auth: { htpasswdSecretName: 'registry-htpasswd' }
		});
		expect(values.builds.registry).toMatchObject({
			endpoint: 'registry.app.example.com',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull'
		});
		// endpoint MUST equal the ingress host, and insecure MUST be false (no DaemonSet).
		expect(values.builds.registry.endpoint).toBe((values.registry.ingress as { host: string }).host);
		expect(values.builds.registry.insecure).toBe(false);
		expect(values.builds.networkPolicy.ingressController).toEqual({
			enabled: true,
			namespace: 'traefik',
			podLabels: { 'app.kubernetes.io/name': 'traefik' },
			ports: [80, 443, 8000, 8443]
		});
	});

	test('platform registry mode uses the resolved cluster issuer instead of a hardcoded issuer', () => {
		const values = buildValues({
			...config,
			certManagerClusterIssuer: { name: 'corp-private-ca', create: false },
			buildRegistry: { mode: 'platform' }
		}) as {
			ingress: { annotations: Record<string, string>; tls: { enabled: boolean } };
			workloadIngress: { clusterIssuer: string };
			registry: { ingress: { clusterIssuer: string } };
		};

		expect(values.ingress.annotations['cert-manager.io/cluster-issuer']).toBe('corp-private-ca');
		expect(values.ingress.tls.enabled).toBe(true);
		expect(values.workloadIngress.clusterIssuer).toBe('corp-private-ca');
		expect(values.registry.ingress.clusterIssuer).toBe('corp-private-ca');
	});

	test('build registry is disabled when buildRegistry is omitted', () => {
		const values = buildValues(config) as { registry: Record<string, unknown>; builds: { registry: { endpoint: string; insecure: boolean } } };
		expect(values.registry).toEqual({ enabled: false });
		expect(values.builds.registry.endpoint).toBe('');
		expect(values.builds.registry.insecure).toBe(false);
	});

	test('external registry mode disables the in-cluster registry and points builds at the endpoint', () => {
		const values = buildValues({ ...config, buildRegistry: { mode: 'external', endpoint: 'ghcr.io/kubwave' } }) as {
			registry: Record<string, unknown>;
			builds: { registry: Record<string, unknown> };
		};
		expect(values.registry).toEqual({ enabled: false });
		expect(values.builds.registry).toMatchObject({
			endpoint: 'ghcr.io/kubwave',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull'
		});
	});

	test('external registry mode allows its explicit port through the builder NetworkPolicy', () => {
		const values = buildValues({ ...config, buildRegistry: { mode: 'external', endpoint: 'registry.example.com:5000/kintex' } }) as {
			builds: { networkPolicy: { egressPorts?: number[] } };
		};
		expect(values.builds.networkPolicy.egressPorts).toEqual([80, 443, 5000]);
	});

	test('external registry mode can opt into insecure HTTP', () => {
		const values = buildValues({
			...config,
			buildRegistry: { mode: 'external', endpoint: 'registry.example.com:5000/kintex', insecure: true }
		}) as {
			builds: { registry: { insecure: boolean } };
		};
		expect(values.builds.registry.insecure).toBe(true);
	});

	test('tenant runtime class flows into tenants.runtimeClass and flips install on', () => {
		const values = buildValues({ ...config, tenantRuntimeClass: 'gvisor' }) as Record<string, any>;
		expect(values['tenants'].runtimeClass.default).toBe('gvisor');
		expect(values['tenants'].runtimeClass.gvisor.install).toBe(true);
	});

	test('no runtime class leaves the chart default (no runtimeClass override)', () => {
		const values = buildValues({ ...config, tenantRuntimeClass: undefined }) as Record<string, any>;
		expect(values['tenants'].runtimeClass?.default ?? '').toBe('');
	});
});
