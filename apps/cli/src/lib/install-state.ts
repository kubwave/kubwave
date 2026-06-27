import { AppsV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import { APP_NAMESPACE, CERT_MANAGER_CLUSTER_ISSUER_NAME, HELM_RELEASE_NAME } from '~/lib/constants.js';
import { execHelm, registryHost } from '~/lib/helm.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { resolveDependencyState } from '~/lib/dependencies.js';
import type { DependencyStateInput, DependencyStateMap } from '~/lib/dependency-state.js';
import { isRecord, readBool, readRecord, readString, readStringMap } from '~/lib/object-path.js';
import type { InstallConfig } from '~/lib/helm.js';

export interface InstallState {
	domain: string;
	imageRegistry: string;
	registryHost: string;
	platformId: string;
	ingressClassName: string;
	ingressControllerNamespace: string;
	storageClass?: string;
	nodeSelector?: Record<string, string>;
	traefikValues: Record<string, unknown>;
	dependencies: DependencyStateMap;
	// HA toggle, persisted (worker-mirrored from the admin setting) so `helm upgrade` re-renders the same replicas/affinity.
	ha: boolean;
	// PSS enforce level for tenant namespaces, persisted so helm upgrade keeps the chosen level, not the chart default. '' = labels disabled.
	tenantPodSecurity?: string;
	// Sandbox runtime for tenant pods, persisted so helm upgrade keeps the chosen class. '' = runc (off); 'gvisor' = gVisor installed and set as default.
	tenantRuntimeClass?: string;
	// Build-registry trust model, persisted so helm upgrade never silently flips an install between platform/external.
	registryMode: 'unconfigured' | 'platform' | 'external';
	registryInsecure: boolean;
	registryIngressEnabled: boolean;
	registryClusterIssuer?: string;
	clusterIssuerName?: string;
}

export type PartialInstallState = Partial<InstallState>;

type HelmValues = Record<string, unknown>;

export function buildInstallState(config: InstallConfig, platformId: string = 'unknown'): InstallState {
	const dependencies = resolveDependencyState({ platformState: config.dependencies });
	const traefik = dependencies.traefik;
	const buildRegistry = config.buildRegistry ?? { mode: 'unconfigured' };
	const clusterIssuerName = config.certManagerClusterIssuer?.name ?? CERT_MANAGER_CLUSTER_ISSUER_NAME;
	return {
		domain: config.domain,
		imageRegistry: config.imageRegistry,
		registryHost:
			buildRegistry.mode === 'external' && buildRegistry.endpoint
				? buildRegistry.endpoint
				: buildRegistry.mode === 'platform'
					? registryHost(config.domain)
					: '',
		platformId,
		ingressClassName: traefik.ingressClassName,
		ingressControllerNamespace: traefik.namespace,
		...(config.storageClass ? { storageClass: config.storageClass } : {}),
		...(config.nodeSelector && Object.keys(config.nodeSelector).length > 0 ? { nodeSelector: config.nodeSelector } : {}),
		traefikValues: traefik.helmValues,
		dependencies,
		ha: config.ha,
		...(config.tenantPodSecurity !== undefined ? { tenantPodSecurity: config.tenantPodSecurity } : {}),
		...(config.tenantRuntimeClass !== undefined ? { tenantRuntimeClass: config.tenantRuntimeClass } : {}),
		registryMode: buildRegistry.mode,
		registryInsecure: buildRegistry.mode === 'external' ? (buildRegistry.insecure ?? false) : false,
		registryIngressEnabled: buildRegistry.mode === 'platform',
		...(buildRegistry.mode === 'platform' ? { registryClusterIssuer: clusterIssuerName } : {}),
		clusterIssuerName
	};
}

export function encodeInstallStateData(state: PartialInstallState | undefined): Record<string, string> {
	if (!state) return {};
	const dependencies = state.dependencies ? resolveDependencyState({ markerState: state.dependencies }) : undefined;
	// dependencies_json supersedes the old per-dependency keys, which we no longer write but still READ so older-CLI markers keep resolving.
	return {
		...(state.domain ? { domain: state.domain } : {}),
		...(state.imageRegistry ? { image_registry: state.imageRegistry } : {}),
		...(state.registryHost ? { registry_host: state.registryHost } : {}),
		...(state.platformId ? { platform_id: state.platformId } : {}),
		...(state.storageClass ? { storage_class: state.storageClass } : {}),
		...(state.nodeSelector ? { node_selector_json: JSON.stringify(state.nodeSelector) } : {}),
		...(state.ha !== undefined ? { ha_enabled: String(state.ha) } : {}),
		...(state.tenantPodSecurity !== undefined ? { tenant_pod_security: state.tenantPodSecurity } : {}),
		...(state.tenantRuntimeClass !== undefined ? { tenant_runtime_class: state.tenantRuntimeClass } : {}),
		...(state.registryMode ? { registry_mode: state.registryMode } : {}),
		...(state.registryInsecure !== undefined ? { registry_insecure: String(state.registryInsecure) } : {}),
		...(state.registryIngressEnabled !== undefined ? { registry_ingress_enabled: String(state.registryIngressEnabled) } : {}),
		...(state.registryClusterIssuer ? { registry_cluster_issuer: state.registryClusterIssuer } : {}),
		...(state.clusterIssuerName ? { cluster_issuer_name: state.clusterIssuerName } : {}),
		...(dependencies ? { dependencies_json: JSON.stringify(dependencies) } : {})
	};
}

export function decodeInstallStateData(data: Record<string, string> | undefined): PartialInstallState | undefined {
	if (!data) return undefined;
	if (!hasInstallStateData(data)) return undefined;
	const nodeSelector = parseStringRecord(data['node_selector_json']);
	const traefikValues = parseObject(data['traefik_values_json']);
	const dependenciesInput = parseObject(data['dependencies_json']) as DependencyStateInput | undefined;
	const hasDependencyData =
		dependenciesInput !== undefined ||
		data['ingress_class_name'] !== undefined ||
		data['ingress_controller_namespace'] !== undefined ||
		traefikValues !== undefined;
	const dependencies = hasDependencyData
		? resolveDependencyState({
				markerState: dependenciesInput,
				legacy: {
					...(data['ingress_class_name'] ? { ingressClassName: data['ingress_class_name'] } : {}),
					...(data['ingress_controller_namespace'] ? { ingressControllerNamespace: data['ingress_controller_namespace'] } : {}),
					...(traefikValues ? { traefikValues } : {})
				}
			})
		: undefined;
	const registryMode = parseRegistryMode(data['registry_mode']);
	const state: PartialInstallState = {
		...(data['domain'] ? { domain: data['domain'] } : {}),
		...(data['image_registry'] ? { imageRegistry: data['image_registry'] } : {}),
		...(data['registry_host'] ? { registryHost: data['registry_host'] } : {}),
		...(data['platform_id'] ? { platformId: data['platform_id'] } : {}),
		...(data['ingress_class_name'] ? { ingressClassName: data['ingress_class_name'] } : {}),
		...(data['ingress_controller_namespace'] ? { ingressControllerNamespace: data['ingress_controller_namespace'] } : {}),
		...(data['storage_class'] ? { storageClass: data['storage_class'] } : {}),
		...(nodeSelector ? { nodeSelector } : {}),
		...(data['ha_enabled'] !== undefined ? { ha: data['ha_enabled'] === 'true' } : {}),
		...(data['tenant_pod_security'] !== undefined ? { tenantPodSecurity: data['tenant_pod_security'] } : {}),
		...(data['tenant_runtime_class'] !== undefined ? { tenantRuntimeClass: data['tenant_runtime_class'] } : {}),
		...(registryMode ? { registryMode } : {}),
		...(data['registry_insecure'] !== undefined ? { registryInsecure: data['registry_insecure'] === 'true' } : {}),
		...(data['registry_ingress_enabled'] !== undefined ? { registryIngressEnabled: data['registry_ingress_enabled'] === 'true' } : {}),
		...(data['registry_cluster_issuer'] ? { registryClusterIssuer: data['registry_cluster_issuer'] } : {}),
		...(data['cluster_issuer_name'] ? { clusterIssuerName: data['cluster_issuer_name'] } : {}),
		...(traefikValues ? { traefikValues } : {}),
		...(dependencies ? { dependencies } : {})
	};
	return Object.keys(state).length > 0 ? state : undefined;
}

function hasInstallStateData(data: Record<string, string>): boolean {
	return [
		'domain',
		'image_registry',
		'registry_host',
		'platform_id',
		'ingress_class_name',
		'ingress_controller_namespace',
		'storage_class',
		'node_selector_json',
		'ha_enabled',
		'tenant_pod_security',
		'tenant_runtime_class',
		'registry_mode',
		'registry_insecure',
		'registry_ingress_enabled',
		'registry_cluster_issuer',
		'cluster_issuer_name',
		'traefik_values_json',
		'dependencies_json'
	].some(key => data[key] !== undefined);
}

export async function resolveInstallState(
	kc: KubeConfig,
	opts: {
		markerState?: PartialInstallState;
		registryOverride?: string;
		namespace?: string;
	} = {}
): Promise<InstallState> {
	const namespace = opts.namespace ?? APP_NAMESPACE;
	const values = await readReleaseValues(namespace);
	const marker = opts.markerState ?? {};
	const liveIngress = await readLivePlatformIngress(kc, namespace);
	const dependencies = resolveDependencyState({
		markerState: marker.dependencies,
		helmValues: values,
		legacy: dependencyLegacyFrom(marker, values, liveIngress)
	});
	const traefik = dependencies.traefik;
	const domain =
		marker.domain ?? readString(values, ['ingress', 'host']) ?? hostFromUrl(readString(values, ['api', 'env', 'APP_BASE_URL'])) ?? liveIngress?.host;

	if (!domain) {
		throw new Error(
			'Cannot determine installed platform domain. Run a local update with --registry and ensure ingress.host is set in the Helm release.'
		);
	}

	const imageRegistry =
		opts.registryOverride ??
		marker.imageRegistry ??
		imageRegistryFromRepository(readString(values, ['api', 'image', 'repository']), 'api') ??
		imageRegistryFromRepository(readString(values, ['worker', 'image', 'repository']), 'worker') ??
		(await readLiveImageRegistry(kc, namespace));
	if (!imageRegistry) {
		throw new Error(
			'Cannot determine installed image registry. Run a local update with --registry <registry> once so the registry can be persisted to the platform marker.'
		);
	}

	const storageClass =
		marker.storageClass ??
		readString(values, ['postgres', 'storage', 'storageClassName']) ??
		readString(values, ['workloadStorage', 'storageClassName']);
	const nodeSelector = marker.nodeSelector ?? readStringMap(values, ['api', 'nodeSelector']) ?? readStringMap(values, ['worker', 'nodeSelector']);
	const registryEnabled = readBool(values, ['registry', 'enabled']);
	const buildRegistryEndpoint = readString(values, ['builds', 'registry', 'endpoint']);
	const registryMode =
		marker.registryMode ??
		(registryEnabled === true ? 'platform' : buildRegistryEndpoint ? 'external' : registryEnabled === false ? 'unconfigured' : 'platform');
	const registryIngressEnabled =
		marker.registryIngressEnabled ?? (registryMode === 'platform' ? (readBool(values, ['registry', 'ingress', 'enabled']) ?? false) : false);
	const clusterIssuerName =
		marker.clusterIssuerName ??
		readString(values, ['certManager', 'clusterIssuer', 'name']) ??
		readString(values, ['workloadIngress', 'clusterIssuer']) ??
		readString(values, ['ingress', 'annotations', 'cert-manager.io/cluster-issuer']) ??
		liveIngress?.clusterIssuerName;
	const registryClusterIssuer =
		marker.registryClusterIssuer ??
		readString(values, ['registry', 'ingress', 'clusterIssuer']) ??
		(registryIngressEnabled ? clusterIssuerName : undefined);
	const registryInsecure =
		marker.registryInsecure ??
		readBool(values, ['builds', 'registry', 'insecure']) ??
		(registryMode === 'platform' ? !registryIngressEnabled || !registryClusterIssuer : false);
	// Marker first, then live release value: readString drops '' (off), but the marker preserves it so the off level survives.
	const tenantPodSecurity = marker.tenantPodSecurity ?? readString(values, ['tenants', 'podSecurity']);
	const tenantRuntimeClass = marker.tenantRuntimeClass ?? readString(values, ['tenants', 'runtimeClass', 'default']);

	return {
		domain,
		imageRegistry,
		registryHost:
			marker.registryHost ??
			readString(values, ['registry', 'ingress', 'host']) ??
			readString(values, ['builds', 'registry', 'endpoint']) ??
			(registryMode === 'platform' ? registryHost(domain) : ''),
		platformId: marker.platformId ?? inferPlatformId(marker.nodeSelector ?? readStringMap(values, ['api', 'nodeSelector'])) ?? 'unknown',
		ingressClassName: traefik.ingressClassName,
		ingressControllerNamespace: traefik.namespace,
		...(storageClass ? { storageClass } : {}),
		...(nodeSelector ? { nodeSelector } : {}),
		traefikValues: traefik.helmValues,
		dependencies,
		// Marker (worker-mirrored toggle) first, then live release values; off for pre-HA installs.
		ha: marker.ha ?? readBool(values, ['ha', 'enabled']) ?? false,
		...(tenantPodSecurity !== undefined ? { tenantPodSecurity } : {}),
		...(tenantRuntimeClass !== undefined ? { tenantRuntimeClass } : {}),
		registryMode,
		registryInsecure,
		registryIngressEnabled,
		...(registryClusterIssuer ? { registryClusterIssuer } : {}),
		...(clusterIssuerName ? { clusterIssuerName } : {})
	};
}

export async function resolveInstalledDependencyState(
	kc: KubeConfig,
	markerState?: PartialInstallState,
	namespace: string = APP_NAMESPACE
): Promise<DependencyStateMap> {
	const values = await readReleaseValues(namespace);
	const liveIngress = await readLivePlatformIngress(kc, namespace);
	return resolveDependencyState({
		markerState: markerState?.dependencies,
		helmValues: values,
		legacy: dependencyLegacyFrom(markerState ?? {}, values, liveIngress)
	});
}

function dependencyLegacyFrom(
	marker: PartialInstallState,
	values: HelmValues,
	liveIngress: { className?: string } | undefined
): {
	ingressClassName?: string;
	ingressControllerNamespace?: string;
	traefikValues?: Record<string, unknown>;
} {
	const ingressClassName =
		marker.ingressClassName ??
		readString(values, ['ingress', 'className']) ??
		readString(values, ['workloadIngress', 'className']) ??
		liveIngress?.className;
	const ingressControllerNamespace = marker.ingressControllerNamespace ?? readString(values, ['workloadIngress', 'controllerNamespace']);
	const traefikValues = marker.traefikValues ?? readRecord(values, ['update', 'dependencies', 'traefik', 'values']);

	return {
		...(ingressClassName ? { ingressClassName } : {}),
		...(ingressControllerNamespace ? { ingressControllerNamespace } : {}),
		...(traefikValues ? { traefikValues } : {})
	};
}

async function readReleaseValues(namespace: string): Promise<HelmValues> {
	const { stdout, exitCode } = await execHelm(['get', 'values', HELM_RELEASE_NAME, '-n', namespace, '-o', 'json', '--all']);
	if (exitCode !== 0) return {};
	try {
		const parsed = JSON.parse(stdout) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

async function readLivePlatformIngress(
	kc: KubeConfig,
	namespace: string
): Promise<{ host?: string; className?: string; clusterIssuerName?: string } | undefined> {
	if (typeof kc.makeApiClient !== 'function') return undefined;
	const api = kc.makeApiClient(NetworkingV1Api);
	try {
		const ingress = await api.readNamespacedIngress({ name: 'console', namespace });
		const host = ingress.spec?.rules?.find(rule => rule.host)?.host ?? ingress.spec?.tls?.flatMap(tls => tls.hosts ?? []).find(Boolean);
		const className = ingress.spec?.ingressClassName;
		const clusterIssuerName = ingress.metadata?.annotations?.['cert-manager.io/cluster-issuer'];
		if (!host && !className && !clusterIssuerName) return undefined;
		return { ...(host ? { host } : {}), ...(className ? { className } : {}), ...(clusterIssuerName ? { clusterIssuerName } : {}) };
	} catch {
		// Best-effort: fall back to release values / marker for domain + ingress class.
		return undefined;
	}
}

async function readLiveImageRegistry(kc: KubeConfig, namespace: string): Promise<string | undefined> {
	if (typeof kc.makeApiClient !== 'function') return undefined;
	const api = kc.makeApiClient(AppsV1Api);
	for (const workload of ['api', 'worker', 'console'] as const) {
		try {
			const dep = await api.readNamespacedDeployment({ name: workload, namespace });
			const image = dep.spec?.template?.spec?.containers?.find(c => c.name === workload)?.image ?? dep.spec?.template?.spec?.containers?.[0]?.image;
			const registry = imageRegistryFromImage(image, workload);
			if (registry) return registry;
		} catch (err) {
			if (!isNotFoundError(err)) return undefined;
		}
	}
	return undefined;
}

function imageRegistryFromImage(image: string | undefined, workload: string): string | undefined {
	if (!image) return undefined;
	const slash = image.lastIndexOf('/');
	const colon = image.lastIndexOf(':');
	const repo = colon > slash ? image.slice(0, colon) : image;
	return imageRegistryFromRepository(repo, workload);
}

export function imageRegistryFromRepository(repository: string | undefined, workload: string): string | undefined {
	if (!repository) return undefined;
	const suffix = `/${workload}`;
	if (repository.endsWith(suffix)) return repository.slice(0, -suffix.length);
	const slash = repository.lastIndexOf('/');
	return slash > 0 ? repository.slice(0, slash) : undefined;
}

function inferPlatformId(nodeSelector: Record<string, string> | undefined): string | undefined {
	return nodeSelector?.['cfke.io/provider'] === 'hetzner' ? 'cloudfleet-hetzner' : undefined;
}

function hostFromUrl(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		return new URL(raw).host;
	} catch {
		return undefined;
	}
}

function parseStringRecord(raw: string | undefined): Record<string, string> | undefined {
	const parsed = parseObject(raw);
	if (!parsed) return undefined;
	const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseObject(raw: string | undefined): Record<string, unknown> | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function parseRegistryMode(value: string | undefined): InstallState['registryMode'] | undefined {
	if (value === 'unconfigured' || value === 'platform' || value === 'external') return value;
	return undefined;
}
