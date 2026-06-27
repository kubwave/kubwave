import { stringify } from 'yaml';
import {
	APP_NAMESPACE,
	CERT_MANAGER_CLUSTER_ISSUER_NAME,
	HELM_RELEASE_NAME,
	IMAGE_PULL_SECRET_NAME,
	INTERNAL_REGISTRY_ENDPOINT,
	REGISTRY_HTPASSWD_SECRET_NAME,
	REGISTRY_PULL_SECRET_NAME,
	REGISTRY_PUSH_SECRET_NAME
} from '~/lib/constants.js';
import { buildUpdateDependencyValues } from '~/lib/dependencies.js';
import { mergeDependencyState, type DependencyStateInput, type DependencyStateMap } from '~/lib/dependency-state.js';
import { writeValuesFile } from '~/lib/values-file.js';
import { getHelmPath, getChartPath } from '~/lib/embedded.js';
import { buildRegistryNetworkPolicyEgressPorts, platformRegistryHost } from '@kubwave/kube';
import { HelmCommandError } from '~/lib/errors.js';
import type { CertManagerClusterIssuerConfig } from '~/lib/cert-manager.js';

// Build registry trust model: platform = Kubwave-managed (TLS, or legacy in-cluster HTTP on upgrades); external = operator-supplied.
export type BuildRegistryConfig =
	| { mode: 'unconfigured' }
	| { mode: 'platform'; endpoint?: string; ingressEnabled?: boolean; insecure?: boolean; clusterIssuer?: string }
	| { mode: 'external'; endpoint: string; insecure?: boolean };

export interface InstallConfig {
	domain: string;
	email: string;
	version: string;
	imageRegistry: string;
	namespace: string;
	storageClass?: string;
	nodeSelector?: Record<string, string>;
	dependencies?: DependencyStateInput;
	certManagerClusterIssuer?: CertManagerClusterIssuerConfig;
	// HA: 3 replicas of api/console/worker + CNPG, soft-spread across nodes. Set by --ha, persisted to the marker, reconciled from the admin ha setting.
	ha: boolean;
	buildRegistry?: BuildRegistryConfig;
	// PSS enforce level stamped on each tenant namespace ('' disables the labels). Set by --tenant-pod-security (default baseline), persisted to the marker.
	tenantPodSecurity?: string;
	// Sandbox runtime for tenant pods ('' = runc). Set by --tenant-runtime-class, persisted; 'gvisor' auto-installs the runtimeClass on all Linux nodes.
	tenantRuntimeClass?: string;
}

export async function execHelm(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const helmPath = getHelmPath();

	let proc: ReturnType<typeof spawnHelm>;
	try {
		proc = spawnHelm(helmPath, args);
	} catch (err) {
		// Bun.spawn throws synchronously when the OS refuses exec (e.g. EACCES); return a failed result so best-effort readers degrade.
		return { stdout: '', stderr: describeSpawnFailure(helmPath, err), exitCode: 126 };
	}

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { stdout, stderr, exitCode };
}

function spawnHelm(helmPath: string, args: string[]) {
	return Bun.spawn([helmPath, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env }
	});
}

function describeSpawnFailure(helmPath: string, err: unknown): string {
	const code = (err as { code?: string } | null)?.code;
	const base = `Failed to execute helm at ${helmPath}`;
	switch (code) {
		case 'EACCES':
			return `${base}: permission denied. The binary exists but cannot be executed — its filesystem is likely mounted noexec, or the execute bit is missing. In-cluster, set KUBWAVE_HELM_BIN to a helm on an executable filesystem (e.g. the /usr/local/bin/helm baked into the CLI image).`;
		case 'ENOEXEC':
			return `${base}: exec format error — this helm binary was built for a different architecture than the node it is running on.`;
		case 'ENOENT':
			return `${base}: no such file — the helm binary is missing at this path.`;
		default:
			return `${base}: ${err instanceof Error ? err.message : String(err)}`;
	}
}

export function generateValuesFile(config: InstallConfig): string {
	return writeValuesFile('kubwave-install-', generateValuesYaml(config));
}

export function generateValuesYaml(config: InstallConfig): string {
	return stringify(buildValues(config));
}

// Pre-resolved production values shared by install (buildValues) and upgrade (buildUpgradeValues); agnostic to InstallConfig vs InstallState.
export interface ProductionValuesInput {
	domain: string;
	imageRegistry: string;
	buildRegistry: BuildRegistryConfig;
	version: string; // image tag
	ingressClassName: string;
	ingressControllerNamespace: string;
	storageClass?: string;
	nodeSelector?: Record<string, string>;
	dependencies: DependencyStateMap;
	ha: boolean;
	clusterIssuerName?: string;
	// PSS enforce level for tenant namespaces. Undefined → omit (chart default 'baseline'); '' explicitly disables the PSS labels.
	tenantPodSecurity?: string;
	// Sandbox runtime for tenant pods. Undefined → omit (runc); 'gvisor' emits runtimeClass.default + gvisor.install=true so the chart installs gVisor.
	tenantRuntimeClass?: string;
	// Install-only: emits the certManager cluster-issuer block. Upgrade omits it (--reset-then-reuse-values reuses the existing issuer).
	certManagerClusterIssuer?: CertManagerClusterIssuerConfig;
}

const cloudfleetDnsPolicy = {
	namespace: 'kube-system',
	podLabels: { 'k8s-app': 'coredns' },
	serviceIp: '10.96.0.10/32'
};

const productionConsoleResources = {
	requests: { cpu: '100m', memory: '256Mi' },
	limits: { cpu: '1000m', memory: '1Gi' }
};

function registryValues(input: ProductionValuesInput): { registry: Record<string, unknown>; builds: Record<string, unknown> } {
	const buildDefaults = {
		engine: 'buildkit',
		builderImage: 'moby/buildkit:v0.31.0-rootless',
		buildToolsImage: `${input.imageRegistry}/build-tools:${input.version}`
	};
	const networkPolicy = (egressPorts?: number[], ingressController = false) => ({
		enabled: true,
		dns: cloudfleetDnsPolicy,
		...(egressPorts ? { egressPorts } : {}),
		...(ingressController
			? {
					ingressController: {
						enabled: true,
						namespace: input.ingressControllerNamespace,
						podLabels: { 'app.kubernetes.io/name': 'traefik' },
						ports: [80, 443, 8000, 8443]
					}
				}
			: {})
	});
	const reg = input.buildRegistry;

	if (reg.mode === 'unconfigured') {
		return {
			registry: { enabled: false },
			builds: {
				...buildDefaults,
				registry: { endpoint: '', insecure: false, pushSecretName: '', pullSecretName: '' },
				networkPolicy: networkPolicy()
			}
		};
	}

	if (reg.mode === 'external') {
		const egressPorts = buildRegistryNetworkPolicyEgressPorts(reg.endpoint);
		return {
			registry: { enabled: false },
			builds: {
				...buildDefaults,
				registry: {
					endpoint: reg.endpoint,
					insecure: reg.insecure ?? false,
					pushSecretName: REGISTRY_PUSH_SECRET_NAME,
					pullSecretName: REGISTRY_PULL_SECRET_NAME
				},
				networkPolicy: networkPolicy(egressPorts)
			}
		};
	}

	const nodeSelector = input.nodeSelector && Object.keys(input.nodeSelector).length > 0 ? { nodeSelector: input.nodeSelector } : {};
	const storage = input.storageClass ? { storage: { storageClassName: input.storageClass } } : {};
	const ingressEnabled = reg.ingressEnabled ?? true;
	const clusterIssuer = reg.clusterIssuer ?? input.clusterIssuerName ?? '';
	const endpoint = reg.endpoint ?? (ingressEnabled ? registryHost(input.domain) : INTERNAL_REGISTRY_ENDPOINT);
	const insecure = reg.insecure ?? (!ingressEnabled || !clusterIssuer);
	const auth = ingressEnabled ? { auth: { htpasswdSecretName: REGISTRY_HTPASSWD_SECRET_NAME } } : {};
	const ingress = ingressEnabled ? { enabled: true, host: endpoint, className: input.ingressClassName, clusterIssuer } : { enabled: false };
	const registrySecretRefs = ingressEnabled
		? { pushSecretName: REGISTRY_PUSH_SECRET_NAME, pullSecretName: REGISTRY_PULL_SECRET_NAME }
		: { pushSecretName: '', pullSecretName: '' };

	// mode === 'platform'
	return {
		registry: {
			enabled: true,
			...storage,
			ingress,
			...auth,
			...nodeSelector
		},
		builds: {
			...buildDefaults,
			registry: { endpoint, insecure, ...registrySecretRefs },
			networkPolicy: networkPolicy(undefined, ingressEnabled)
		}
	};
}

// Single source of truth for production helm values (programmatic values-cloudfleet-hetzner.yaml).
// Must emit the full api/console/worker shape — prod layers no other file, so anything omitted falls back to the chart's DEV defaults (broken install).
export function buildProductionValues(input: ProductionValuesInput): Record<string, unknown> {
	const nodeSelector = input.nodeSelector && Object.keys(input.nodeSelector).length > 0 ? { nodeSelector: input.nodeSelector } : {};
	const ingressClassName = input.ingressClassName;
	const clusterIssuerName = input.clusterIssuerName ?? input.certManagerClusterIssuer?.name ?? '';
	const image = (app: string) => ({
		repository: `${input.imageRegistry}/${app}`,
		tag: input.version,
		pullPolicy: 'IfNotPresent'
	});
	return {
		imagePullSecrets: [{ name: IMAGE_PULL_SECRET_NAME }],
		// HA master switch (explicit, not the chart default, so prod values stay self-contained). Off → 1 replica each; on → 3 + PDBs + 3 CNPG instances.
		ha: { enabled: input.ha, replicas: 3 },
		// api — backend entrypoint; reads JWT_SECRET (+ GITHUB_TOKEN) from the CLI-pre-created console-creds, so the chart adopts that Secret instead of its own.
		api: {
			serviceAccount: { create: true },
			image: image('backend'),
			secret: { create: false, existingSecret: 'console-creds' },
			env: {
				APP_BASE_URL: `https://${input.domain}`,
				SMTP_HOST: '' // no dev mailcrab in prod; admin-configured SMTP (DB) takes over
			},
			...nodeSelector
		},
		// console — pure API consumer (INTERNAL_API_URL = chart default). No Secret, no k8s RBAC.
		console: {
			image: image('console'),
			// Prod runs the standalone Nitro build; don't inherit the chart's higher dev-server memory, which makes small preview nodes look artificially full.
			resources: productionConsoleResources,
			...nodeSelector
		},
		// worker — backend worker entrypoint + self-update. Read-write RBAC via its own SA.
		worker: {
			serviceAccount: { create: true },
			image: image('backend'),
			...nodeSelector
		},
		postgres: {
			// CloudNativePG-managed (operator + Cluster CR); CLI pre-creates the basic-auth postgres-app-creds bootstrap alongside postgres-creds.
			mode: 'cnpg',
			// CLI pre-creates `postgres-creds`; tell the chart not to manage its own.
			secret: { create: false, existingSecret: 'postgres-creds' },
			...(input.storageClass ? { storage: { storageClassName: input.storageClass } } : {}),
			...nodeSelector
		},
		// Same-origin ingress: one host, path-routed (/api → api, / → console).
		ingress: {
			className: ingressClassName,
			host: input.domain,
			annotations: clusterIssuerName ? { 'cert-manager.io/cluster-issuer': clusterIssuerName } : {},
			tls: { enabled: Boolean(clusterIssuerName) }
		},
		// Ingress the worker stamps onto tenant domains; mirror the platform ingress so they get TLS too, else they fall to dev defaults (HTTP, no class).
		workloadIngress: {
			className: ingressClassName,
			clusterIssuer: clusterIssuerName,
			// The per-env NetworkPolicy whitelists this namespace so an enforcing CNI lets Traefik reach tenant pods; the kube-system default leaves them unreachable.
			controllerNamespace: input.ingressControllerNamespace,
			// Empty → worker reads the controller Service LB status and sslip-encodes the real IPv4; a literal (e.g. 127.0.0.1) pins every auto-domain to that IP.
			loadBalancerIp: ''
		},
		// Install-only: on upgrade cert-manager is already configured and helm reuses existing values (--reset-then-reuse-values), so we must not re-emit it.
		...(input.certManagerClusterIssuer
			? {
					certManager: {
						clusterIssuer: {
							name: input.certManagerClusterIssuer.name,
							create: input.certManagerClusterIssuer.create,
							...(input.certManagerClusterIssuer.create ? { email: input.certManagerClusterIssuer.email } : {})
						}
					}
				}
			: {}),
		adminer: { enabled: false },
		mailcrab: { enabled: false },
		// docs is dev-only (prod ships static to Cloudflare); the chart defaults it on, so prod MUST disable it or ErrImageNeverPulls hangs --wait.
		docs: { enabled: false },
		// CLI writes the platform-marker ConfigMap itself (version-marker.ts); chart must not render it too.
		platformMarker: { create: false },
		update: {
			serviceAccount: { create: true },
			image: { repository: `${input.imageRegistry}/cli`, tag: input.version },
			dependencies: buildUpdateDependencyValues(input.dependencies),
			...nodeSelector
		},
		...registryValues(input),
		// Tenant namespace hardening: turn egress confinement ON (Cilium-enforced); podSecurity stays the chart baseline unless --tenant-pod-security overrides it.
		tenants: {
			...(input.tenantPodSecurity !== undefined ? { podSecurity: input.tenantPodSecurity } : {}),
			...(input.tenantRuntimeClass
				? {
						runtimeClass: {
							default: input.tenantRuntimeClass,
							[input.tenantRuntimeClass]: { install: true }
						}
					}
				: {}),
			egress: {
				enabled: true,
				dnsPodLabels: cloudfleetDnsPolicy.podLabels,
				dnsServiceIp: cloudfleetDnsPolicy.serviceIp
			}
		}
	};
}

// Install-time adapter: resolves dependency state and feeds the shared production-values builder.
export function buildValues(config: InstallConfig): Record<string, unknown> {
	const dependencies = mergeDependencyState(config.dependencies);
	const certManagerClusterIssuer = config.certManagerClusterIssuer ?? {
		name: CERT_MANAGER_CLUSTER_ISSUER_NAME,
		create: true,
		email: config.email
	};
	return buildProductionValues({
		domain: config.domain,
		imageRegistry: config.imageRegistry,
		buildRegistry: config.buildRegistry ?? { mode: 'unconfigured' },
		version: config.version,
		// The IngressClass Traefik registers, kept consistent across the readiness check, the platform ingress, and the tenant workload ingress.
		ingressClassName: dependencies.traefik.ingressClassName,
		ingressControllerNamespace: dependencies.traefik.namespace,
		...(config.storageClass ? { storageClass: config.storageClass } : {}),
		...(config.nodeSelector && Object.keys(config.nodeSelector).length > 0 ? { nodeSelector: config.nodeSelector } : {}),
		dependencies,
		ha: config.ha,
		// buildProductionValues drops these when undefined, so the omit-contract lives in one place there.
		tenantPodSecurity: config.tenantPodSecurity,
		tenantRuntimeClass: config.tenantRuntimeClass,
		clusterIssuerName: certManagerClusterIssuer.name,
		certManagerClusterIssuer
	});
}

// Registry host registry.<domain>, behind the console's Traefik + cert-manager TLS so the node runtime trusts it via a public CA (no per-node config).
export function registryHost(domain: string): string {
	return platformRegistryHost(domain);
}

export async function helmUninstall(release: string, namespace: string): Promise<{ removed: boolean }> {
	const args = ['uninstall', release, '--namespace', namespace, '--wait'];
	const { stdout, stderr, exitCode } = await execHelm(args);

	if (exitCode === 0) return { removed: true };

	const combined = `${stderr}\n${stdout}`;
	if (/not found/i.test(combined)) return { removed: false };

	throw new HelmCommandError(args, { stdout, stderr, exitCode });
}

// Release names in a namespace; returns [] for no releases, missing namespace, or unreachable cluster (can't distinguish "gone" from "empty").
export async function listReleaseNames(namespace: string): Promise<string[]> {
	const args = ['list', '-n', namespace, '-q'];
	const { stdout, exitCode } = await execHelm(args);
	if (exitCode !== 0) return [];
	return stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);
}

// CNPG bootstrap (operator → volume → initdb → primary) routinely exceeds 5m; default 10m, override via KUBWAVE_INSTALL_TIMEOUT for slow clusters.
const DEFAULT_INSTALL_TIMEOUT = '10m';

export async function helmUpgradeInstall(config: InstallConfig, valuesFilePath: string): Promise<void> {
	const chartPath = getChartPath();
	const timeout = process.env.KUBWAVE_INSTALL_TIMEOUT?.trim() || DEFAULT_INSTALL_TIMEOUT;
	const args = [
		'upgrade',
		'--install',
		HELM_RELEASE_NAME,
		chartPath,
		'-f',
		valuesFilePath,
		'--namespace',
		config.namespace || APP_NAMESPACE,
		'--create-namespace',
		'--wait',
		'--timeout',
		timeout
	];
	const { stdout, stderr, exitCode } = await execHelm(args);

	if (exitCode !== 0) {
		throw new HelmCommandError(args, { stdout, stderr, exitCode });
	}
}
