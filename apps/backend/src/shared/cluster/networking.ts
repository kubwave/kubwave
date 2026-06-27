import type { CoreV1Api, NetworkingV1Api, V1Ingress, V1Service } from '@kubernetes/client-node';
import type { Deployment, DeploymentLogEntry, ServiceDomain } from '@kubwave/db';
import { LABEL_MANAGED_BY, LABEL_NAME, LABEL_SERVICE_ID, MANAGED_BY_VALUE, internalServiceName, resourceName, selectorLabels } from '@kubwave/kube';
import { deleteIgnoreMissing, readIngressOrNull, readServiceOrNull, replaceWithRetry } from './ops.js';

// Per-cluster Ingress knobs from worker env, threaded through the deploy context so deployers stay free of process.env reads.
export interface IngressOptions {
	// IngressClass name to set (undefined -> leave unset, cluster default class applies).
	className?: string;
	// cert-manager ClusterIssuer for automatic TLS (undefined -> HTTP only, no spec.tls).
	clusterIssuer?: string;
	// Extra annotations merged onto every tenant Ingress (provider-specific config).
	annotations: Record<string, string>;
}

// Labels on every worker-created object for a service; shared so the API can address them when reading live status (worker is the only writer).
export function commonLabels(serviceId: string): Record<string, string> {
	return {
		[LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
		[LABEL_NAME]: resourceName(serviceId),
		[LABEL_SERVICE_ID]: serviceId
	};
}

export function stepEvent(step: string, message: string): DeploymentLogEntry {
	return { ts: new Date().toISOString(), level: 'info', step, message };
}

type ResourceAction = 'created' | 'replaced' | 'deleted' | 'unchanged';

function pushServiceEvent(events: DeploymentLogEntry[], namespace: string, serviceId: string, ports: number[], action: ResourceAction): void {
	const portList = normalizePorts(ports).join(', ') || 'none';
	const name = internalServiceName(serviceId);
	if (action === 'created') events.push(stepEvent('service-converged', `Created Service ${name} in ${namespace} (ports: ${portList})`));
	else if (action === 'replaced') events.push(stepEvent('service-converged', `Updated Service ${name} in ${namespace} (ports: ${portList})`));
	else if (action === 'deleted') events.push(stepEvent('service-converged', `Removed Service ${name} in ${namespace} (no ports exposed)`));
}

function pushIngressEvent(
	events: DeploymentLogEntry[],
	namespace: string,
	serviceId: string,
	domains: ServiceDomain[],
	action: ResourceAction
): void {
	const hosts = domains.map(domain => domain.host).sort();
	const name = resourceName(serviceId);
	const hostList = hosts.join(', ') || 'none';
	if (action === 'created') events.push(stepEvent('ingress-converged', `Created Ingress ${name} in ${namespace} (hosts: ${hostList})`));
	else if (action === 'replaced') events.push(stepEvent('ingress-converged', `Updated Ingress ${name} in ${namespace} (hosts: ${hostList})`));
	else if (action === 'deleted') events.push(stepEvent('ingress-converged', `Removed Ingress ${name} in ${namespace} (no domains)`));
}

function normalizePorts(ports: number[]): number[] {
	return Array.from(new Set(ports)).sort((a, b) => a - b);
}

function samePorts(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((port, i) => port === b[i]);
}

function buildService(serviceId: string, namespace: string, ports: number[]): V1Service {
	return {
		apiVersion: 'v1',
		kind: 'Service',
		metadata: { name: internalServiceName(serviceId), namespace, labels: commonLabels(serviceId) },
		spec: {
			type: 'ClusterIP',
			selector: selectorLabels(serviceId),
			// k8s requires named ports past the first; name deterministically so a re-render isn't a diff.
			ports: ports.map(port => ({ name: `p-${port}`, port, targetPort: port, protocol: 'TCP' }))
		}
	};
}

// One Ingress per service, a rule per domain -> port; a clusterIssuer adds the cert-manager annotation + spec.tls, else HTTP-only. Plain v1 so any controller works.
function buildIngress(serviceId: string, namespace: string, domains: ServiceDomain[], ingress: IngressOptions): V1Ingress {
	const name = resourceName(serviceId);
	const serviceName = internalServiceName(serviceId);
	const annotations = { ...ingress.annotations };
	if (ingress.clusterIssuer) annotations['cert-manager.io/cluster-issuer'] = ingress.clusterIssuer;
	const hosts = domains.map(domain => domain.host);
	return {
		apiVersion: 'networking.k8s.io/v1',
		kind: 'Ingress',
		metadata: {
			name,
			namespace,
			labels: commonLabels(serviceId),
			...(Object.keys(annotations).length > 0 ? { annotations } : {})
		},
		spec: {
			...(ingress.className ? { ingressClassName: ingress.className } : {}),
			...(ingress.clusterIssuer ? { tls: [{ hosts, secretName: `${name}-tls` }] } : {}),
			rules: domains.map(domain => ({
				host: domain.host,
				http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: serviceName, port: { number: domain.port } } } }] }
			}))
		}
	};
}

// Converge the Service; clusterIP is immutable so carry it over on replace, and return the action so the caller logs only real changes.
async function convergeService(coreApi: CoreV1Api, namespace: string, serviceId: string, ports: number[]): Promise<ResourceAction> {
	const name = internalServiceName(serviceId);
	const existing = await readServiceOrNull(coreApi, namespace, name);
	const desired = normalizePorts(ports);

	if (desired.length === 0) {
		if (!existing) return 'unchanged';
		await deleteIgnoreMissing(() => coreApi.deleteNamespacedService({ name, namespace }));
		return 'deleted';
	}

	if (!existing) {
		await coreApi.createNamespacedService({ namespace, body: buildService(serviceId, namespace, desired) });
		return 'created';
	}
	const existingPorts = (existing.spec?.ports ?? []).map(p => p.port).sort((a, b) => a - b);
	if (!samePorts(existingPorts, desired)) {
		await replaceWithRetry({
			label: `Service ${name}`,
			read: () => readServiceOrNull(coreApi, namespace, name),
			build: () => buildService(serviceId, namespace, desired),
			carryOver: (fresh, svcBody) => {
				svcBody.metadata = { ...svcBody.metadata, resourceVersion: fresh.metadata?.resourceVersion ?? undefined };
				svcBody.spec = { ...svcBody.spec, clusterIP: fresh.spec?.clusterIP, clusterIPs: fresh.spec?.clusterIPs };
				return svcBody;
			},
			replace: body => coreApi.replaceNamespacedService({ name, namespace, body })
		});
		return 'replaced';
	}
	return 'unchanged';
}

function ingressFingerprint(ing: V1Ingress): string {
	const className = ing.spec?.ingressClassName ?? '';
	const rules = (ing.spec?.rules ?? [])
		.map(r => {
			const backend = r.http?.paths?.[0]?.backend?.service;
			return `${r.host ?? ''}=${backend?.name ?? ''}:${backend?.port?.number ?? ''}`;
		})
		.sort();
	const tls = (ing.spec?.tls ?? []).map(t => `${(t.hosts ?? []).slice().sort().join(',')}|${t.secretName ?? ''}`).sort();
	return JSON.stringify({ className, rules, tls });
}

function ingressMatches(existing: V1Ingress, desired: V1Ingress): boolean {
	if (ingressFingerprint(existing) !== ingressFingerprint(desired)) return false;
	const existingAnn = existing.metadata?.annotations ?? {};
	return Object.entries(desired.metadata?.annotations ?? {}).every(([k, v]) => existingAnn[k] === v);
}

// Converge the Ingress; on replace, merge our annotations over the live ones to preserve controller-added ones (e.g. cert-manager).
async function convergeIngress(
	netApi: NetworkingV1Api,
	namespace: string,
	serviceId: string,
	domains: ServiceDomain[],
	ingress: IngressOptions
): Promise<ResourceAction> {
	const name = resourceName(serviceId);
	const existing = await readIngressOrNull(netApi, namespace, name);

	if (domains.length === 0) {
		if (!existing) return 'unchanged';
		await deleteIgnoreMissing(() => netApi.deleteNamespacedIngress({ name, namespace }));
		return 'deleted';
	}

	const desired = buildIngress(serviceId, namespace, domains, ingress);
	if (!existing) {
		await netApi.createNamespacedIngress({ namespace, body: desired });
		return 'created';
	}
	if (!ingressMatches(existing, desired)) {
		await replaceWithRetry({
			label: `Ingress ${name}`,
			read: () => readIngressOrNull(netApi, namespace, name),
			build: () => buildIngress(serviceId, namespace, domains, ingress),
			carryOver: (fresh, desiredBody) => {
				desiredBody.metadata = {
					...desiredBody.metadata,
					resourceVersion: fresh.metadata?.resourceVersion ?? undefined,
					annotations: { ...fresh.metadata?.annotations, ...desiredBody.metadata?.annotations }
				};
				return desiredBody;
			},
			replace: body => netApi.replaceNamespacedIngress({ name, namespace, body })
		});
		return 'replaced';
	}
	return 'unchanged';
}

export async function convergeNetworking(args: {
	coreApi: CoreV1Api;
	netApi: NetworkingV1Api;
	namespace: string;
	deployment: Deployment;
	// Ports the workload's containers expose (e.g. the docker-image containerPort).
	ports: number[];
	domains: ServiceDomain[];
	ingress: IngressOptions;
	events: DeploymentLogEntry[];
}): Promise<void> {
	const { coreApi, netApi, namespace, deployment, ports, domains, ingress, events } = args;
	const serviceId = deployment.serviceId;
	// The Service must expose container ports AND every port a domain routes to.
	const servicePorts = [...ports, ...domains.map(domain => domain.port)];
	pushServiceEvent(events, namespace, serviceId, servicePorts, await convergeService(coreApi, namespace, serviceId, servicePorts));
	pushIngressEvent(events, namespace, serviceId, domains, await convergeIngress(netApi, namespace, serviceId, domains, ingress));
}

export async function teardownNetworking(args: { coreApi: CoreV1Api; netApi: NetworkingV1Api; namespace: string; serviceId: string }): Promise<void> {
	const { coreApi, netApi, namespace, serviceId } = args;
	const serviceName = internalServiceName(serviceId);
	const ingressName = resourceName(serviceId);
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedService({ name: serviceName, namespace }));
	await deleteIgnoreMissing(() => netApi.deleteNamespacedIngress({ name: ingressName, namespace }));
}
