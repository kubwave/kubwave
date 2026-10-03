import { isIPv6 } from 'node:net';
import { CoreV1Api, type KubeConfig, type V1Service } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import { FatalCliError } from '~/lib/errors.js';
import { dnsPolicyForPlatform, type DnsPolicy } from '~/lib/helm.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';

const DNS_SERVICE = { namespace: 'kube-system', name: 'kube-dns' };

// k3s lets operators move the DNS Service (--service-cidr/--cluster-dns) or replace CoreDNS, so the tenant and
// build DNS egress rules take the ClusterIP and pod selector from the live Service instead of k3s defaults.
export async function resolveK3sDnsPolicy(kc: KubeConfig): Promise<DnsPolicy> {
	let service: V1Service;
	try {
		service = await kc.makeApiClient(CoreV1Api).readNamespacedService(DNS_SERVICE);
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
		throw new FatalCliError(
			'Service kube-system/kube-dns not found. kubwave scopes tenant and build DNS egress to the cluster DNS Service, which k3s creates unless it was started with --disable=coredns. Restore CoreDNS (or expose your DNS as kube-system/kube-dns) and re-run the install.'
		);
	}

	const fallback = dnsPolicyForPlatform('k3s');
	const clusterIp = service.spec?.clusterIP;
	const selector = service.spec?.selector;
	const policy: DnsPolicy = {
		namespace: DNS_SERVICE.namespace,
		podLabels: selector && Object.keys(selector).length > 0 ? selector : fallback.podLabels,
		serviceIp: clusterIp && clusterIp !== 'None' ? `${clusterIp}/${isIPv6(clusterIp) ? 128 : 32}` : ''
	};
	p.log.info(`Cluster DNS: ${policy.serviceIp || 'no ClusterIP'} (${formatLabels(policy.podLabels)})`);
	return policy;
}

function formatLabels(labels: Record<string, string>): string {
	return Object.entries(labels)
		.map(([key, value]) => `${key}=${value}`)
		.join(', ');
}
