import type { KubeConfig } from '@kubernetes/client-node';
import { ApiextensionsV1Api, AppsV1Api, CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import { FatalCliError, UserCancelledError } from '~/lib/errors.js';
import { execHelm } from '~/lib/helm.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { mergeDependencyState, type DependencyStateInput, type DependencyStateMap, type TraefikDependencyState } from '~/lib/dependency-state.js';
import { readRecord, readString } from '~/lib/object-path.js';
import { TRAEFIK_CHART, TRAEFIK_CHART_NAME, TRAEFIK_CHART_VERSION, TRAEFIK_REPO_URL, writeTraefikValuesFile } from '~/lib/traefik.js';

// repo/chart for the helm-repo-add path; bare name for the inline --repo form (helm reads repo/chart under --repo literally and fails to find it).
const CERT_MANAGER_NAMESPACE = 'cert-manager';
const CERT_MANAGER_RELEASE = 'cert-manager';
const CERT_MANAGER_CHART = 'jetstack/cert-manager';
const CERT_MANAGER_CHART_NAME = 'cert-manager';
const CERT_MANAGER_REPO_URL = 'https://charts.jetstack.io';
const CERT_MANAGER_CLUSTER_ISSUER_CRD = 'clusterissuers.cert-manager.io';
const CERT_MANAGER_DEPLOYMENTS = ['cert-manager', 'cert-manager-webhook', 'cert-manager-cainjector'] as const;
const TRAEFIK_READINESS_TIMEOUT_MS = 90 * 1000;
const TRAEFIK_READINESS_POLL_MS = 3000;
const CERT_MANAGER_READINESS_TIMEOUT_MS = 90 * 1000;
const CERT_MANAGER_READINESS_POLL_MS = 3000;
// CloudNativePG operator (cluster-wide in cnpg-system); chart version unpinned — upstream supports only the latest point release.
const CNPG_NAMESPACE = 'cnpg-system';
const CNPG_RELEASE = 'cnpg';
const CNPG_CHART = 'cnpg/cloudnative-pg';
const CNPG_REPO_URL = 'https://cloudnative-pg.github.io/charts';
const CNPG_CLUSTER_CRD = 'clusters.postgresql.cnpg.io';
const CNPG_READINESS_TIMEOUT_MS = 120 * 1000;
const CNPG_READINESS_POLL_MS = 3000;

export interface ClusterDependency {
	id: keyof DependencyStateMap;
	name: string;
	description: string;
	check: (kc: KubeConfig, state: DependencyStateMap) => Promise<DependencyStatus>;
	install: (kc: KubeConfig, state: DependencyStateMap, context?: string) => Promise<void>;
	wait: (kc: KubeConfig, state: DependencyStateMap) => Promise<void>;
	legacyState?: (input: DependencyStateResolveInput) => DependencyStateInput | undefined;
	upgradeValues?: (state: DependencyStateMap) => Record<string, unknown>;
}

export interface DependencyStatus {
	installed: boolean;
	message: string;
}

export interface EnsureResult {
	name: string;
	alreadyInstalled: boolean;
	installed: boolean;
	message: string;
}

export interface HelmInstallOptions {
	wait?: boolean;
	timeout?: string;
	// Kube context for spawned helm: it reads current-context from disk, not the in-memory KubeConfig, so without it deps install into the wrong cluster.
	context?: string;
}

export interface DependencyStateResolveInput {
	markerState?: DependencyStateInput;
	platformState?: DependencyStateInput;
	helmValues?: Record<string, unknown>;
	legacy?: {
		ingressClassName?: string;
		ingressControllerNamespace?: string;
		traefikValues?: Record<string, unknown>;
	};
}

export async function helmRepoAddAndInstall(
	repo: { name: string; url: string },
	chart: string,
	release: string,
	namespace: string,
	extraArgs: string[] = [],
	options: HelmInstallOptions = {}
): Promise<void> {
	const addResult = await execHelm(['repo', 'add', repo.name, repo.url, '--force-update']);
	if (addResult.exitCode !== 0) {
		throw new Error(`Helm repo "${repo.name}" could not be added:\n${addResult.stderr}`);
	}

	await execHelm(['repo', 'update', repo.name]);

	const installResult = await execHelm(buildHelmDependencyInstallArgs(chart, release, namespace, extraArgs, options));
	if (installResult.exitCode !== 0) {
		throw new Error(`Installation of "${release}" failed:\n${installResult.stderr}`);
	}
}

export function buildHelmDependencyInstallArgs(
	chart: string,
	release: string,
	namespace: string,
	extraArgs: string[] = [],
	options: HelmInstallOptions = {}
): string[] {
	const wait = options.wait ?? true;
	const timeout = options.timeout ?? '5m';
	const args = ['upgrade', '--install', release, chart, '--namespace', namespace, '--create-namespace'];

	if (options.context) {
		args.push('--kube-context', options.context);
	}

	if (wait) {
		args.push('--wait', '--timeout', timeout);
	}

	return [...args, ...extraArgs];
}

export function buildTraefikDependencyHelmArgs(config: TraefikDependencyState = mergeDependencyState().traefik, valuesFilePath?: string): string[] {
	return [
		'upgrade',
		'--install',
		config.releaseName,
		TRAEFIK_CHART_NAME,
		'--repo',
		TRAEFIK_REPO_URL,
		'--namespace',
		config.namespace,
		'--create-namespace',
		'--reuse-values',
		'--version',
		TRAEFIK_CHART_VERSION,
		...(valuesFilePath ? ['-f', valuesFilePath] : [])
	];
}

export function buildCertManagerDependencyHelmArgs(): string[] {
	return [
		'upgrade',
		'--install',
		CERT_MANAGER_RELEASE,
		CERT_MANAGER_CHART_NAME,
		'--repo',
		CERT_MANAGER_REPO_URL,
		'--namespace',
		CERT_MANAGER_NAMESPACE,
		'--create-namespace',
		'--reuse-values',
		'--set',
		'crds.enabled=true',
		'--wait',
		'--timeout',
		'5m'
	];
}

const DEPENDENCIES: ClusterDependency[] = [
	{
		id: 'traefik',
		name: 'Traefik',
		description: 'Ingress controller for HTTP routing and TLS termination',
		check: async (kc, state) => {
			const config = state.traefik;
			const api = kc.makeApiClient(NetworkingV1Api);
			try {
				const list = await api.listIngressClass();
				const traefik = list.items.find(ic => ic.metadata?.name === config.ingressClassName);
				if (traefik) {
					return { installed: true, message: 'Traefik IngressClass found' };
				}
				if (list.items.length > 0) {
					const names = list.items.map(ic => ic.metadata?.name).filter(Boolean);
					return { installed: true, message: `IngressClass found: ${names.join(', ')} (not Traefik, but present)` };
				}
				return { installed: false, message: 'No IngressClass found' };
			} catch {
				return { installed: false, message: 'IngressClass check failed' };
			}
		},
		install: async (kc, state, context) => {
			const config = state.traefik;
			const valuesFile = writeTraefikValuesFile(config);
			await helmRepoAddAndInstall(
				{ name: 'traefik', url: TRAEFIK_REPO_URL },
				TRAEFIK_CHART,
				config.releaseName,
				config.namespace,
				// Pin the validated chart version + --reuse-values so a partial pre-existing release keeps operator overrides; the rendered values file overlays last.
				['--version', TRAEFIK_CHART_VERSION, '--reuse-values', '-f', valuesFile],
				{
					wait: false,
					context
				}
			);
			await waitForTraefikReady(kc, { controller: config });
			await logTraefikLoadBalancerPending(kc, config);
		},
		wait: async (kc, state) => {
			await waitForTraefikReady(kc, { controller: state.traefik });
		},
		legacyState: input => {
			const ingressClassName =
				input.legacy?.ingressClassName ??
				readString(input.helmValues, ['ingress', 'className']) ??
				readString(input.helmValues, ['workloadIngress', 'className']);
			const namespace = input.legacy?.ingressControllerNamespace ?? readString(input.helmValues, ['workloadIngress', 'controllerNamespace']);
			const helmValues = input.legacy?.traefikValues ?? readRecord(input.helmValues, ['update', 'dependencies', 'traefik', 'values']);

			if (!ingressClassName && !namespace && !helmValues) return undefined;
			return {
				traefik: {
					kind: 'traefik',
					...(ingressClassName ? { ingressClassName } : {}),
					...(namespace ? { namespace } : {}),
					...(helmValues ? { helmValues } : {})
				}
			};
		},
		upgradeValues: state => {
			return { traefik: { values: state.traefik.helmValues } };
		}
	},
	{
		id: 'certManager',
		name: 'cert-manager',
		description: "Automatic TLS certificates via Let's Encrypt",
		check: async kc => {
			const extensionsApi = kc.makeApiClient(ApiextensionsV1Api);
			const appsApi = kc.makeApiClient(AppsV1Api);
			try {
				const crd = await extensionsApi.readCustomResourceDefinition({ name: CERT_MANAGER_CLUSTER_ISSUER_CRD });
				if (!isCrdEstablished(crd)) {
					return { installed: false, message: 'cert-manager CRDs found, but not established' };
				}

				const missing = await listUnreadyDeployments(appsApi, CERT_MANAGER_NAMESPACE, CERT_MANAGER_DEPLOYMENTS);
				if (missing.length > 0) {
					return { installed: false, message: `cert-manager CRDs found, but controller deployments are not ready: ${missing.join(', ')}` };
				}

				return { installed: true, message: 'cert-manager controller ready' };
			} catch (err: unknown) {
				if (isNotFoundError(err)) {
					return { installed: false, message: 'cert-manager is not installed' };
				}
				return { installed: false, message: 'cert-manager check failed' };
			}
		},
		install: async (_kc, _state, context) => {
			await helmRepoAddAndInstall(
				{ name: 'jetstack', url: CERT_MANAGER_REPO_URL },
				CERT_MANAGER_CHART,
				CERT_MANAGER_RELEASE,
				CERT_MANAGER_NAMESPACE,
				['--set', 'crds.enabled=true'],
				{ context }
			);
		},
		wait: async kc => {
			await waitForCertManagerReady(kc);
		}
	},
	{
		id: 'cnpg',
		name: 'CloudNativePG',
		description: 'PostgreSQL operator that runs the platform database (Cluster CR)',
		check: async kc => {
			const api = kc.makeApiClient(ApiextensionsV1Api);
			try {
				await api.readCustomResourceDefinition({ name: CNPG_CLUSTER_CRD });
				return { installed: true, message: 'CloudNativePG CRDs found' };
			} catch (err: unknown) {
				if (isNotFoundError(err)) {
					return { installed: false, message: 'CloudNativePG is not installed' };
				}
				return { installed: false, message: 'CloudNativePG check failed' };
			}
		},
		install: async (_kc, _state, context) => {
			// helm --wait blocks until the operator + CRDs are ready, so the chart's `Cluster` CR has somewhere to land.
			await helmRepoAddAndInstall({ name: 'cnpg', url: CNPG_REPO_URL }, CNPG_CHART, CNPG_RELEASE, CNPG_NAMESPACE, [], { context });
		},
		wait: async kc => {
			await waitForCnpgReady(kc);
		}
	}
];

export function resolveDependencyState(input: DependencyStateResolveInput = {}): DependencyStateMap {
	const legacyStates = DEPENDENCIES.map(dependency => dependency.legacyState?.(input));

	return mergeDependencyState(...legacyStates, input.platformState, input.markerState);
}

export function buildUpdateDependencyValues(state: DependencyStateInput | DependencyStateMap | undefined): Record<string, unknown> {
	const resolved = mergeDependencyState(state);
	const values: Record<string, unknown> = { mode: 'auto' };

	for (const dependency of DEPENDENCIES) {
		const dependencyValues = dependency.upgradeValues?.(resolved);

		if (dependencyValues) {
			Object.assign(values, dependencyValues);
		}
	}

	return values;
}

export function getDependencies(): ClusterDependency[] {
	return DEPENDENCIES;
}

export async function checkDependencies(
	kc: KubeConfig,
	dependencyState?: DependencyStateInput | DependencyStateMap
): Promise<Array<{ dependency: ClusterDependency; status: DependencyStatus }>> {
	const results: Array<{ dependency: ClusterDependency; status: DependencyStatus }> = [];
	const state = mergeDependencyState(dependencyState);

	for (const dependency of DEPENDENCIES) {
		results.push({ dependency, status: await dependency.check(kc, state) });
	}

	return results;
}

export async function confirmDependencyInstall(dep: ClusterDependency): Promise<void> {
	const shouldInstall = await p.confirm({
		message: `Install ${dep.name} now? (${dep.description})`
	});

	if (p.isCancel(shouldInstall)) {
		throw new UserCancelledError(`${dep.name} installation cancelled.`);
	}

	if (!shouldInstall) {
		throw new FatalCliError(`${dep.name} is required. Installation aborted.`);
	}
}

export async function ensureDependencies(
	kc: KubeConfig,
	dependencyState?: DependencyStateInput | DependencyStateMap,
	context?: string
): Promise<EnsureResult[]> {
	const results: EnsureResult[] = [];
	const state = mergeDependencyState(dependencyState);

	for (const { dependency: dep, status } of await checkDependencies(kc, state)) {
		if (status.installed) {
			p.log.success(`${dep.name}: ${status.message}`);
			results.push({ name: dep.name, alreadyInstalled: true, installed: false, message: status.message });
			continue;
		}

		p.log.warn(`${dep.name}: ${status.message}`);
		await confirmDependencyInstall(dep);

		const spinner = p.spinner();

		spinner.start(`Installing ${dep.name}...`);
		try {
			await dep.install(kc, state, context);
			spinner.stop(`${dep.name} installed`);
			results.push({ name: dep.name, alreadyInstalled: false, installed: true, message: `${dep.name} successfully installed` });
		} catch (err) {
			spinner.stop(`${dep.name} installation failed`);
			p.log.error(err instanceof Error ? err.message : String(err));
			throw err;
		}
	}

	return results;
}

export async function ensureDependenciesSilent(
	kc: KubeConfig,
	reporter: { start: (msg: string) => void; succeed: (msg: string) => void; fail: (msg: string, detail: string) => void; log: (msg: string) => void },
	dependencyState?: DependencyStateInput | DependencyStateMap,
	context?: string
): Promise<EnsureResult[]> {
	const results: EnsureResult[] = [];
	const state = mergeDependencyState(dependencyState);

	for (const dep of DEPENDENCIES) {
		reporter.start(`Checking ${dep.name}...`);
		const status = await dep.check(kc, state);

		if (status.installed) {
			reporter.succeed(`${dep.name}: ${status.message}`);
			results.push({ name: dep.name, alreadyInstalled: true, installed: false, message: status.message });
			continue;
		}

		reporter.log(`${dep.name}: ${status.message} — installing...`);
		reporter.start(`Installing ${dep.name}...`);

		try {
			await dep.install(kc, state, context);
			reporter.succeed(`${dep.name} installed`);
			results.push({ name: dep.name, alreadyInstalled: false, installed: true, message: `${dep.name} successfully installed` });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			reporter.fail(`${dep.name} installation failed`, msg);
			throw err;
		}
	}

	return results;
}

export async function waitDependencies(
	kc: KubeConfig,
	dependencyState?: DependencyStateInput | DependencyStateMap,
	reporter?: { start: (msg: string) => void; succeed: (msg: string) => void }
): Promise<void> {
	const state = mergeDependencyState(dependencyState);

	for (const dep of DEPENDENCIES) {
		reporter?.start(`Waiting for ${dep.name}...`);
		await dep.wait(kc, state);
		reporter?.succeed(`${dep.name} ready`);
	}
}

export async function waitForTraefikReady(
	kc: KubeConfig,
	options: { timeoutMs?: number; pollMs?: number; controller?: TraefikDependencyState } = {}
): Promise<void> {
	const controller = options.controller ?? mergeDependencyState().traefik;
	const appsApi = kc.makeApiClient(AppsV1Api);
	const networkingApi = kc.makeApiClient(NetworkingV1Api);
	const timeoutMs = options.timeoutMs ?? TRAEFIK_READINESS_TIMEOUT_MS;
	const pollMs = options.pollMs ?? TRAEFIK_READINESS_POLL_MS;
	const deadline = Date.now() + timeoutMs;

	let lastError: unknown;
	let lastStatus = 'waiting for deployment and IngressClass';

	while (Date.now() < deadline) {
		try {
			const [deploymentReady, ingressClassReady] = await Promise.all([
				isTraefikDeploymentReady(appsApi, controller),
				isTraefikIngressClassReady(networkingApi, controller)
			]);

			if (deploymentReady && ingressClassReady) return;

			lastStatus = `deployment ${deploymentReady ? 'ready' : 'not ready'}, IngressClass ${ingressClassReady ? 'present' : 'missing'}`;
		} catch (err) {
			lastError = err;
		}

		await Bun.sleep(pollMs);
	}

	const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';

	throw new Error(`Traefik did not become ready within ${Math.round(timeoutMs / 1000)}s (${lastStatus}).${detail}`);
}

export async function waitForCertManagerReady(kc: KubeConfig, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<void> {
	const extensionsApi = kc.makeApiClient(ApiextensionsV1Api);
	const appsApi = kc.makeApiClient(AppsV1Api);
	const timeoutMs = options.timeoutMs ?? CERT_MANAGER_READINESS_TIMEOUT_MS;
	const pollMs = options.pollMs ?? CERT_MANAGER_READINESS_POLL_MS;
	const deadline = Date.now() + timeoutMs;

	let lastError: unknown;
	let lastStatus = 'waiting for CRDs and controller deployments';

	while (Date.now() < deadline) {
		try {
			const crd = await extensionsApi.readCustomResourceDefinition({ name: CERT_MANAGER_CLUSTER_ISSUER_CRD });
			const crdReady = isCrdEstablished(crd);
			const missing = await listUnreadyDeployments(appsApi, CERT_MANAGER_NAMESPACE, CERT_MANAGER_DEPLOYMENTS);

			if (crdReady && missing.length === 0) return;

			lastStatus = `CRD ${crdReady ? 'established' : 'not established'}, deployments ${missing.length === 0 ? 'ready' : `not ready: ${missing.join(', ')}`}`;
		} catch (err) {
			lastError = err;

			if (!isNotFoundError(err)) {
				throw err;
			}
		}

		await Bun.sleep(pollMs);
	}

	const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';

	throw new Error(`cert-manager did not become ready within ${Math.round(timeoutMs / 1000)}s (${lastStatus}).${detail}`);
}

export async function waitForCnpgReady(kc: KubeConfig, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<void> {
	const api = kc.makeApiClient(ApiextensionsV1Api);
	const timeoutMs = options.timeoutMs ?? CNPG_READINESS_TIMEOUT_MS;
	const pollMs = options.pollMs ?? CNPG_READINESS_POLL_MS;
	const deadline = Date.now() + timeoutMs;

	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const crd = await api.readCustomResourceDefinition({ name: CNPG_CLUSTER_CRD });
			// Established → the apiserver serves postgresql.cnpg.io/v1, so the chart's Cluster CR applies.
			const established = crd.status?.conditions?.some(condition => condition.type === 'Established' && condition.status === 'True');

			if (established) return;
		} catch (err) {
			lastError = err;

			if (!isNotFoundError(err)) {
				throw err;
			}
		}

		await Bun.sleep(pollMs);
	}

	const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';

	throw new Error(`CloudNativePG CRDs did not become established within ${Math.round(timeoutMs / 1000)}s.${detail}`);
}

async function isTraefikDeploymentReady(api: AppsV1Api, controller: TraefikDependencyState): Promise<boolean> {
	return isDeploymentReady(await api.readNamespacedDeployment({ namespace: controller.namespace, name: controller.releaseName }));
}

function isDeploymentReady(dep: { spec?: { replicas?: number }; status?: { readyReplicas?: number; updatedReplicas?: number } }): boolean {
	const desired = dep.spec?.replicas ?? 1;
	const ready = dep.status?.readyReplicas ?? 0;
	const updated = dep.status?.updatedReplicas ?? 0;

	return ready >= desired && updated >= desired;
}

function isCrdEstablished(crd: { status?: { conditions?: Array<{ type?: string; status?: string }> } }): boolean {
	return crd.status?.conditions?.some(condition => condition.type === 'Established' && condition.status === 'True') ?? false;
}

async function listUnreadyDeployments(api: AppsV1Api, namespace: string, names: readonly string[]): Promise<string[]> {
	const unready: string[] = [];

	for (const name of names) {
		try {
			const dep = await api.readNamespacedDeployment({ namespace, name });
			if (!isDeploymentReady(dep)) unready.push(name);
		} catch (err) {
			if (isNotFoundError(err)) {
				unready.push(name);
				continue;
			}
			throw err;
		}
	}

	return unready;
}

async function isTraefikIngressClassReady(api: NetworkingV1Api, controller: TraefikDependencyState): Promise<boolean> {
	try {
		await api.readIngressClass({ name: controller.ingressClassName });
		return true;
	} catch (err) {
		if (isNotFoundError(err)) return false;
		throw err;
	}
}

async function logTraefikLoadBalancerPending(kc: KubeConfig, controller: TraefikDependencyState): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	try {
		const service = await api.readNamespacedService({ namespace: controller.namespace, name: controller.releaseName });
		const ingress = service.status?.loadBalancer?.ingress ?? [];

		if (service.spec?.type === 'LoadBalancer' && ingress.length === 0) {
			p.log.info('Traefik is ready; cloud LoadBalancer external IP provisioning may continue in the background.');
		}
	} catch {
		// Informational only; readiness is covered by deployment + IngressClass.
	}
}
