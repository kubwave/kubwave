export const APP_NAMESPACE = 'kubwave';
export const HELM_RELEASE_NAME = 'kubwave';
export const CERT_MANAGER_CLUSTER_ISSUER_NAME = 'letsencrypt-prod';
export const CERT_MANAGER_ACME_SERVER = 'https://acme-v02.api.letsencrypt.org/directory';

export const PLATFORM_CONFIGMAP_NAME = 'kubwave-platform';
export const DEFAULT_REGISTRY = 'ghcr.io/kubwave';

// In-cluster Dockerfile-build registry (ClusterIP, plain HTTP, anonymous): BuildKit pushes, containerd pulls via the registry trust DaemonSet.
export const INTERNAL_REGISTRY_ENDPOINT = `kubwave-registry.${APP_NAMESPACE}.svc.cluster.local:5000`;

// Platform TLS registry secrets: htpasswd read by registry:2; registry-creds is BuildKit's push cred, worker-copied to tenants as kubwave-registry-pull.
export const REGISTRY_HTPASSWD_SECRET_NAME = 'registry-htpasswd';
export const REGISTRY_PUSH_SECRET_NAME = 'registry-creds';
export const REGISTRY_PULL_SECRET_NAME = 'kubwave-registry-pull';

// Traefik install namespace (dev uses kube-system); the per-env NetworkPolicy must allow ingress from here or a strict CNI blocks Traefik → tenants.
export const TRAEFIK_NAMESPACE = 'traefik';

// part-of=kubwave is the single cluster-wide ownership/audit anchor carried by the chart, CLI-created objects, CSI
// drivers, and (via a post-install label sweep) dependency charts; component/instance discriminate the piece.
export const KUBWAVE_PART_OF_LABEL = 'app.kubernetes.io/part-of';
export const KUBWAVE_PART_OF_VALUE = 'kubwave';
export const KUBWAVE_COMPONENT_LABEL = 'app.kubernetes.io/component';
export const KUBWAVE_INSTANCE_LABEL = 'app.kubernetes.io/instance';
export const KUBWAVE_PART_OF_SELECTOR = `${KUBWAVE_PART_OF_LABEL}=${KUBWAVE_PART_OF_VALUE}`;

export const APP_LABELS = {
	[KUBWAVE_PART_OF_LABEL]: KUBWAVE_PART_OF_VALUE
} as const;

// Mirrors @kubwave/kube (MANAGED_BY_VALUE); worker stamps every per-env namespace/workload, uninstall sweeps by this selector.
export const WORKER_MANAGED_BY_SELECTOR = 'app.kubernetes.io/managed-by=kubwave-worker';

// managed-by=kubwave-cli marks resources the CLI fully owns (manifest objects, self-created SCs) — never
// third-party helm output, which keeps its own managed-by=Helm.
export const KUBWAVE_MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const KUBWAVE_CLI_MANAGED_BY_VALUE = 'kubwave-cli';

// Shared prefix on every cluster-scoped object; uninstall sweeps label-less ClusterRole(Binding) leftovers helm can't reclaim.
export const APP_CLUSTER_RESOURCE_PREFIX = 'kubwave-';

// CNPG/cert-manager ship resource-policy:keep CRDs helm won't remove; uninstall sweeps these exact groups —
// matched by group, not name-endsWith, which would also catch nested third-party groups like trust.cert-manager.io.
export const KEPT_DEPENDENCY_CRD_GROUPS: readonly string[] = ['postgresql.cnpg.io', 'cert-manager.io', 'acme.cert-manager.io'];
