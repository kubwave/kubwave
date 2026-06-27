import type { CoreV1Api, NetworkingV1Api, V1Namespace, V1NetworkPolicy, V1NetworkPolicyEgressRule } from '@kubernetes/client-node';
import { environmentNamespace, LABEL_ENVIRONMENT_ID, LABEL_MANAGED_BY, MANAGED_BY_VALUE } from '@kubwave/kube';
import { createIgnoreConflict, notFoundToNull, replaceWithRetry } from './ops.js';

// Provisions per-environment namespaces (NetworkPolicy + Pod Security); worker is the only writer, and takes config rather than env to stay testable.

const ISOLATION_POLICY_NAME = 'kubwave-isolation';

// Pod Security admission labels; both pin `latest` so the policy tracks the cluster's k8s version.
const PSS_ENFORCE_LABEL = 'pod-security.kubernetes.io/enforce';
const PSS_ENFORCE_VERSION_LABEL = 'pod-security.kubernetes.io/enforce-version';
const PSS_WARN_LABEL = 'pod-security.kubernetes.io/warn';
const PSS_WARN_VERSION_LABEL = 'pod-security.kubernetes.io/warn-version';
// Every PSS label we manage, so a switch to '' (off) can strip them from existing namespaces.
const PSS_LABEL_KEYS = [PSS_ENFORCE_LABEL, PSS_ENFORCE_VERSION_LABEL, PSS_WARN_LABEL, PSS_WARN_VERSION_LABEL];

// Egress confinement for tenant pods; `dnsNamespace` re-allows CoreDNS, whose ClusterIP sits inside the blocked ranges.
export interface TenantEgressConfig {
	blockedCidrs: string[];
	dnsNamespace: string;
	dnsPodLabels: Record<string, string>;
	dnsServiceIp?: string | undefined;
}

export interface TenantIsolationConfig {
	// Pod Security Standards enforce level ('' disables the labels entirely).
	podSecurityEnforce: string;
	// Sandbox runtime class for tenant pods ('' = plain runc); unused by this provisioner but kept here as the single tenant-isolation source of truth.
	runtimeClass: string;
	// null -> ingress-only isolation policy (egress unrestricted, the pre-hardening behaviour).
	egress: TenantEgressConfig | null;
}

function managedLabels(): Record<string, string> {
	return { [LABEL_MANAGED_BY]: MANAGED_BY_VALUE };
}

function namespaceLabels(environmentId: string, podSecurityEnforce: string): Record<string, string> {
	const labels: Record<string, string> = { [LABEL_MANAGED_BY]: MANAGED_BY_VALUE, [LABEL_ENVIRONMENT_ID]: environmentId };
	if (podSecurityEnforce) {
		labels[PSS_ENFORCE_LABEL] = podSecurityEnforce;
		labels[PSS_ENFORCE_VERSION_LABEL] = 'latest';
		labels[PSS_WARN_LABEL] = podSecurityEnforce;
		labels[PSS_WARN_VERSION_LABEL] = 'latest';
	}
	return labels;
}

function buildNamespace(environmentId: string, podSecurityEnforce: string): V1Namespace {
	return {
		apiVersion: 'v1',
		kind: 'Namespace',
		metadata: { name: environmentNamespace(environmentId), labels: namespaceLabels(environmentId, podSecurityEnforce) }
	};
}

function buildEgressRules(egress: TenantEgressConfig): V1NetworkPolicyEgressRule[] {
	const dnsTargets: NonNullable<V1NetworkPolicyEgressRule['to']> = [
		{
			namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': egress.dnsNamespace } },
			podSelector: { matchLabels: egress.dnsPodLabels }
		}
	];
	if (egress.dnsServiceIp) dnsTargets.push({ ipBlock: { cidr: egress.dnsServiceIp } });

	return [
		// Same namespace - pod-to-pod uses pod IPs (inside the blocked ranges), so allow explicitly.
		{ to: [{ podSelector: {} }] },
		// DNS - CoreDNS lives in the blocked ClusterIP range, re-allow or tenants lose name resolution.
		{
			to: dnsTargets,
			ports: [
				{ protocol: 'UDP', port: 53 },
				{ protocol: 'TCP', port: 53 }
			]
		},
		// Public internet: 0.0.0.0/0 minus internal/link-local ranges (blocks other namespaces, the kubelet, cloud-metadata); IPv4 only.
		{ to: [{ ipBlock: { cidr: '0.0.0.0/0', except: egress.blockedCidrs } }] }
	];
}

// Isolation NetworkPolicy: ingress is always default-deny + allow-list (same namespace + ingress controller); egress is confined only when `egress` is set.
function buildIsolationPolicy(namespace: string, ingressControllerNamespace: string, egress: TenantEgressConfig | null): V1NetworkPolicy {
	return {
		apiVersion: 'networking.k8s.io/v1',
		kind: 'NetworkPolicy',
		metadata: { name: ISOLATION_POLICY_NAME, namespace, labels: managedLabels() },
		spec: {
			podSelector: {},
			policyTypes: egress ? ['Ingress', 'Egress'] : ['Ingress'],
			ingress: [
				{
					// `_from` is the client's field name for the NetworkPolicy `from` key (maps back on the wire).
					_from: [
						// Same namespace - intra-environment services may talk to each other.
						{ podSelector: {} },
						// Ingress controller namespace lets external HTTP reach services; `kubernetes.io/metadata.name` is the immutable label k8s stamps on every namespace.
						{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': ingressControllerNamespace } } }
					]
				}
			],
			...(egress ? { egress: buildEgressRules(egress) } : {})
		}
	};
}

// Carry the fresh resourceVersion onto the desired object so a replace (PUT) passes optimistic-concurrency.
function withResourceVersion<T extends { metadata?: { resourceVersion?: string | null } | null }>(desired: T, fresh: T): T {
	return { ...desired, metadata: { ...desired.metadata, resourceVersion: fresh.metadata?.resourceVersion } };
}

// Create when absent, else replace only on drift; a create racing a peer worker is swallowed (409), a replace retries on conflict.
async function ensureResource<T extends { metadata?: { resourceVersion?: string | null; labels?: Record<string, string> } | null }>(opts: {
	label: string;
	read: () => Promise<T | null>;
	build: () => T;
	create: (body: T) => Promise<unknown>;
	replace: (body: T) => Promise<unknown>;
	needsReplace: (existing: T, desired: T) => boolean;
	carryOver?: (fresh: T, desired: T) => T;
}): Promise<void> {
	const existing = await opts.read();
	if (!existing) {
		await createIgnoreConflict(() => opts.create(opts.build()));
		return;
	}
	if (!opts.needsReplace(existing, opts.build())) return;
	await replaceWithRetry({
		label: opts.label,
		read: opts.read,
		build: opts.build,
		carryOver: opts.carryOver ?? ((fresh, desired) => withResourceVersion(desired, fresh)),
		replace: opts.replace
	});
}

async function ensureNamespace(coreApi: CoreV1Api, environmentId: string, podSecurityEnforce: string): Promise<void> {
	const name = environmentNamespace(environmentId);
	await ensureResource<V1Namespace>({
		label: `namespace ${name}`,
		read: () => notFoundToNull(() => coreApi.readNamespace({ name })),
		build: () => buildNamespace(environmentId, podSecurityEnforce),
		create: body => coreApi.createNamespace({ body }),
		replace: body => coreApi.replaceNamespace({ name, body }),
		// Replace on enforce-label drift, including desired '' with a stale label — a Boolean() gate would leave 'off' unable to remove enforcement.
		needsReplace: existing => (existing.metadata?.labels?.[PSS_ENFORCE_LABEL] ?? '') !== podSecurityEnforce,
		// Merge our labels so operator-added labels and spec/finalizers survive, but strip any PSS label no longer desired so 'off' actually removes them.
		carryOver: (fresh, desired) => {
			const labels = { ...fresh.metadata?.labels, ...desired.metadata?.labels };
			for (const key of PSS_LABEL_KEYS) if (!(key in (desired.metadata?.labels ?? {}))) delete labels[key];
			return { ...fresh, metadata: { ...fresh.metadata, labels } };
		}
	});
}

async function ensureIsolationPolicy(
	netApi: NetworkingV1Api,
	namespace: string,
	ingressControllerNamespace: string,
	egress: TenantEgressConfig | null
): Promise<void> {
	const egressSignature = (p: V1NetworkPolicy): string =>
		JSON.stringify({ types: [...(p.spec?.policyTypes ?? [])].sort(), egress: p.spec?.egress ?? null });
	await ensureResource<V1NetworkPolicy>({
		label: `networkpolicy ${ISOLATION_POLICY_NAME}/${namespace}`,
		read: () => notFoundToNull(() => netApi.readNamespacedNetworkPolicy({ name: ISOLATION_POLICY_NAME, namespace })),
		build: () => buildIsolationPolicy(namespace, ingressControllerNamespace, egress),
		create: body => netApi.createNamespacedNetworkPolicy({ namespace, body }),
		replace: body => netApi.replaceNamespacedNetworkPolicy({ name: ISOLATION_POLICY_NAME, namespace, body }),
		// Converge the egress toggle + CIDR/DNS; CIDR strings aren't server-normalized so this won't churn, and ingress is unchanged so it's ignored.
		needsReplace: (existing, desired) => egressSignature(existing) !== egressSignature(desired)
	});
}

export async function ensureEnvironmentNamespace(args: {
	coreApi: CoreV1Api;
	netApi: NetworkingV1Api;
	environmentId: string;
	ingressControllerNamespace: string;
	isolation: TenantIsolationConfig;
}): Promise<string> {
	const { coreApi, netApi, environmentId, ingressControllerNamespace, isolation } = args;
	const namespace = environmentNamespace(environmentId);

	await ensureNamespace(coreApi, environmentId, isolation.podSecurityEnforce);
	await ensureIsolationPolicy(netApi, namespace, ingressControllerNamespace, isolation.egress);

	return namespace;
}
