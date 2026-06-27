export const APP_NAMESPACE = 'kubwave';
export const HELM_RELEASE_NAME = 'kubwave';
export const CERT_MANAGER_CLUSTER_ISSUER_NAME = 'letsencrypt-prod';
export const CERT_MANAGER_ACME_SERVER = 'https://acme-v02.api.letsencrypt.org/directory';

export const PLATFORM_CONFIGMAP_NAME = 'kubwave-platform';
export const DEFAULT_REGISTRY = 'ghcr.io/kubwave';
export const IMAGE_PULL_SECRET_NAME = 'regcred';

// In-cluster Dockerfile-build registry (ClusterIP, plain HTTP, anonymous): BuildKit pushes, containerd pulls via the registry trust DaemonSet.
export const INTERNAL_REGISTRY_ENDPOINT = `kubwave-registry.${APP_NAMESPACE}.svc.cluster.local:5000`;

// Platform TLS registry secrets: htpasswd read by registry:2; registry-creds is BuildKit's push cred, worker-copied to tenants as kubwave-registry-pull.
export const REGISTRY_HTPASSWD_SECRET_NAME = 'registry-htpasswd';
export const REGISTRY_PUSH_SECRET_NAME = 'registry-creds';
export const REGISTRY_PULL_SECRET_NAME = 'kubwave-registry-pull';

// Traefik install namespace (dev uses kube-system); the per-env NetworkPolicy must allow ingress from here or a strict CNI blocks Traefik → tenants.
export const TRAEFIK_NAMESPACE = 'traefik';

export const APP_LABELS = {
	'app.kubernetes.io/part-of': 'kubwave'
} as const;

// Mirrors @kubwave/kube (MANAGED_BY_VALUE); worker stamps every per-env namespace/workload, uninstall sweeps by this selector.
export const WORKER_MANAGED_BY_SELECTOR = 'app.kubernetes.io/managed-by=kubwave-worker';

// Shared prefix on every cluster-scoped object; uninstall sweeps label-less ClusterRole(Binding) leftovers helm can't reclaim.
export const APP_CLUSTER_RESOURCE_PREFIX = 'kubwave-';

// CNPG CRDs carry resource-policy:keep, so helm uninstall cnpg leaves the whole API group behind; uninstall sweeps it to fully remove the operator.
export const CNPG_CRD_GROUP_SUFFIX = '.postgresql.cnpg.io';
