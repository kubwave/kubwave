function num(name: string, fallback: number): number {
	const value = process.env[name];
	return value ? Number(value) : fallback;
}

function bool(name: string, fallback: boolean): boolean {
	const value = process.env[name];
	return value === undefined || value === '' ? fallback : value === 'true';
}

function list(name: string, fallback: string[]): string[] {
	const value = process.env[name];
	if (!value) return fallback;
	const parts = value
		.split(',')
		.map(part => part.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : fallback;
}

function jsonRecord(name: string): Record<string, string> {
	const value = process.env[name];
	if (!value) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]));
	} catch {
		console.warn(`[env] ${name} is not valid JSON; ignoring`);
		return {};
	}
}

export function resolveBuildEngine(value: string | undefined): 'buildkit' {
	const resolved = value || 'buildkit';
	if (resolved !== 'buildkit') throw new Error(`[env] BUILD_ENGINE=${resolved} is not supported; only "buildkit" is available.`);
	return resolved;
}

export interface WorkerRuntimeConfig {
	workerId: string;
	reconcileIntervalMs: number;
	leaseTimeoutMs: number;
	ingressControllerNamespace: string;
	podNamespace: string;
	appVersion: string;
	healthPort: number;
	ingressClassName?: string;
	ingressClusterIssuer?: string;
	ingressAnnotations: Record<string, string>;
	ingressLoadBalancerIp?: string;
	ingressControllerService: string;
	storageClassName: string;
	registryEndpoint: string;
	registryInsecure: boolean;
	buildEngine: 'buildkit';
	builderImage: string;
	buildToolsImage?: string;
	buildImagePullSecrets: string[];
	builderServiceAccount: string;
	registryPullSecretName?: string;
	registryPushSecretName?: string;
	buildTimeoutSeconds: number;
	buildJobTtlSeconds: number;
	buildMemoryRequest: string;
	buildMemoryLimit: string;
	registryPruneKeep: number;
	registryPruneIntervalMs: number;
	registryGcEnabled: boolean;
	registryGcIntervalMs: number;
	volumeAutoscalingIntervalMs: number;
	gitPollIntervalMs: number;
	gitPollBatch: number;
	gitPollServiceIntervalSeconds: number;
	gitLsRemoteTimeoutMs: number;
	gitPollErrorBackoffSeconds: number;
	templateCatalogUrl: string;
	templateCatalogPollIntervalMs: number;
	templateCatalogPollEnabled: boolean;
	prDiscoveryIntervalMs: number;
	prDiscoveryBatch: number;
	prDiscoveryEnvIntervalSeconds: number;
	prometheusImage: string;
	prometheusRetention: string;
	prometheusStorageSize: string;
	tenantPodSecurity: string;
	tenantRuntimeClass: string;
	tenantEgressEnabled: boolean;
	tenantEgressBlockedCidrs: string[];
	dnsNamespace: string;
	dnsPodLabels: Record<string, string>;
	dnsServiceIp?: string;
}

export function resolveWorkerRuntimeConfig(): WorkerRuntimeConfig {
	return {
		workerId: process.env.WORKER_ID ?? process.env.HOSTNAME ?? 'worker',
		reconcileIntervalMs: num('RECONCILE_INTERVAL_MS', 5000),
		leaseTimeoutMs: num('LEASE_TIMEOUT_MS', 60_000),
		ingressControllerNamespace: process.env.INGRESS_CONTROLLER_NAMESPACE ?? 'kube-system',
		podNamespace: process.env.POD_NAMESPACE ?? 'kubwave',
		appVersion: process.env.APP_VERSION ?? 'dev',
		healthPort: num('WORKER_HEALTH_PORT', 8080),
		ingressClassName: process.env.INGRESS_CLASS_NAME || undefined,
		ingressClusterIssuer: process.env.INGRESS_CLUSTER_ISSUER || undefined,
		ingressAnnotations: jsonRecord('INGRESS_ANNOTATIONS'),
		ingressLoadBalancerIp: process.env.INGRESS_LB_IP || undefined,
		ingressControllerService: process.env.INGRESS_CONTROLLER_SERVICE || 'traefik',
		storageClassName: process.env.STORAGE_CLASS_NAME ?? '',
		registryEndpoint: process.env.REGISTRY_ENDPOINT || '',
		registryInsecure: bool('REGISTRY_INSECURE', false),
		buildEngine: resolveBuildEngine(process.env.BUILD_ENGINE),
		builderImage: process.env.BUILDER_IMAGE || 'moby/buildkit:v0.31.0-rootless',
		buildToolsImage: process.env.BUILD_TOOLS_IMAGE || undefined,
		buildImagePullSecrets: list('BUILD_IMAGE_PULL_SECRETS', []),
		builderServiceAccount: process.env.BUILDER_SERVICE_ACCOUNT || 'kubwave-builder',
		registryPullSecretName: process.env.REGISTRY_PULL_SECRET_NAME || undefined,
		registryPushSecretName: process.env.REGISTRY_PUSH_SECRET_NAME || undefined,
		buildTimeoutSeconds: num('BUILD_TIMEOUT_SECONDS', 1800),
		buildJobTtlSeconds: num('BUILD_JOB_TTL_SECONDS', 3600),
		buildMemoryRequest: process.env.BUILD_MEMORY_REQUEST || '1Gi',
		buildMemoryLimit: process.env.BUILD_MEMORY_LIMIT || '2Gi',
		registryPruneKeep: num('REGISTRY_PRUNE_KEEP', 2),
		registryPruneIntervalMs: num('REGISTRY_PRUNE_INTERVAL_MS', 60 * 60 * 1000),
		registryGcEnabled: bool('REGISTRY_GC_ENABLED', true),
		registryGcIntervalMs: num('REGISTRY_GC_INTERVAL_MS', 24 * 60 * 60 * 1000),
		volumeAutoscalingIntervalMs: num('VOLUME_AUTOSCALING_INTERVAL_MS', 5 * 60 * 1000),
		gitPollIntervalMs: num('GIT_POLL_INTERVAL_MS', 15_000),
		gitPollBatch: num('GIT_POLL_BATCH', 20),
		gitPollServiceIntervalSeconds: num('GIT_POLL_SERVICE_INTERVAL_SECONDS', 60),
		gitLsRemoteTimeoutMs: num('GIT_LS_REMOTE_TIMEOUT_MS', 20_000),
		gitPollErrorBackoffSeconds: num('GIT_POLL_ERROR_BACKOFF_SECONDS', 300),
		templateCatalogUrl: process.env.TEMPLATE_CATALOG_URL ?? 'https://raw.githubusercontent.com/kubwave/kubwave/main/packages/templates/catalog.json',
		templateCatalogPollIntervalMs: num('TEMPLATE_CATALOG_POLL_INTERVAL_MS', 1_800_000),
		// Default on (prod pulls catalog updates without redeploy); dev sets false so the API serves
		// the bundled catalog.json (local edits) instead of a remote catalog from main.
		templateCatalogPollEnabled: bool('TEMPLATE_CATALOG_POLL_ENABLED', true),
		prDiscoveryIntervalMs: num('PR_DISCOVERY_INTERVAL_MS', 30_000),
		prDiscoveryBatch: num('PR_DISCOVERY_BATCH', 10),
		prDiscoveryEnvIntervalSeconds: num('PR_DISCOVERY_ENV_INTERVAL_SECONDS', 60),
		prometheusImage: process.env.PROMETHEUS_IMAGE ?? 'prom/prometheus:v2.55.1',
		prometheusRetention: process.env.PROMETHEUS_RETENTION ?? '7d',
		prometheusStorageSize: process.env.PROMETHEUS_STORAGE_SIZE ?? '5Gi',
		tenantPodSecurity: process.env.TENANT_POD_SECURITY ?? 'baseline',
		tenantRuntimeClass: process.env.TENANT_RUNTIME_CLASS ?? '',
		tenantEgressEnabled: bool('TENANT_EGRESS_ENABLED', false),
		tenantEgressBlockedCidrs: list('TENANT_EGRESS_BLOCKED_CIDRS', ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']),
		dnsNamespace: process.env.DNS_NAMESPACE ?? 'kube-system',
		dnsPodLabels: jsonRecord('DNS_POD_LABELS'),
		dnsServiceIp: process.env.DNS_SERVICE_IP || undefined
	};
}

export const env = resolveWorkerRuntimeConfig();
