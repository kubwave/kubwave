import type { NetworkingV1Api, V1NetworkPolicy, V1NetworkPolicyEgressRule } from '@kubernetes/client-node';
import { createIgnoreConflict, readNetworkPolicyOrNull } from '../../../../../../shared/cluster/ops.js';
import { buildJobLabels } from '../../builds/service.js';

const BUILDER_NETWORK_POLICY_NAME = 'kubwave-builder-egress';
const PUBLIC_IPV4_CIDR = '0.0.0.0/0';

export function sshEgressPolicyName(deploymentId: string): string {
	return `private-repo-build-${deploymentId}-np`;
}

export function parsePrivateRepoSshPort(repoUrl: string): number {
	const raw = repoUrl.trim();

	if (raw.startsWith('ssh://')) {
		if (/^ssh:\/\/[^/\s]+:(?=\/)/.test(raw)) throw invalidRepoUrlError();

		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw invalidRepoUrlError();
		}

		if (url.protocol !== 'ssh:' || !url.hostname || !url.pathname || url.pathname === '/') throw invalidRepoUrlError();
		if (!url.port) return 22;

		const port = Number(url.port);
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidRepoUrlError();
		return port;
	}

	if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+$/.test(raw)) return 22;

	throw invalidRepoUrlError();
}

export function buildSshEgressPolicy(args: {
	namespace: string;
	serviceId: string;
	deploymentId: string;
	port: number;
	blockedCidrs: string[];
}): V1NetworkPolicy {
	const labels = buildJobLabels(args.serviceId, args.deploymentId);
	return {
		apiVersion: 'networking.k8s.io/v1',
		kind: 'NetworkPolicy',
		metadata: {
			name: sshEgressPolicyName(args.deploymentId),
			namespace: args.namespace,
			labels
		},
		spec: {
			podSelector: { matchLabels: labels },
			policyTypes: ['Egress'],
			egress: [
				{
					to: [
						{
							ipBlock: {
								cidr: PUBLIC_IPV4_CIDR,
								...(args.blockedCidrs.length > 0 ? { except: args.blockedCidrs } : {})
							}
						}
					],
					ports: [{ protocol: 'TCP', port: args.port }]
				}
			]
		}
	};
}

export async function ensureSshEgressPolicy(args: {
	api: NetworkingV1Api;
	namespace: string;
	serviceId: string;
	deploymentId: string;
	port: number;
}): Promise<void> {
	const builderPolicy = await readNetworkPolicyOrNull(args.api, args.namespace, BUILDER_NETWORK_POLICY_NAME);

	if (!builderPolicy) return;

	await createIgnoreConflict(() =>
		args.api.createNamespacedNetworkPolicy({
			namespace: args.namespace,
			body: buildSshEgressPolicy({
				namespace: args.namespace,
				serviceId: args.serviceId,
				deploymentId: args.deploymentId,
				port: args.port,
				blockedCidrs: publicInternetBlockedCidrs(builderPolicy)
			})
		})
	);
}

function publicInternetBlockedCidrs(policy: V1NetworkPolicy): string[] {
	for (const rule of policy.spec?.egress ?? []) {
		const blocked = blockedCidrsFromRule(rule);
		if (blocked) return blocked;
	}
	return [];
}

function blockedCidrsFromRule(rule: V1NetworkPolicyEgressRule): string[] | null {
	for (const target of rule.to ?? []) {
		const ipBlock = target.ipBlock;
		if (ipBlock?.cidr === PUBLIC_IPV4_CIDR) return ipBlock.except ?? [];
	}
	return null;
}

function invalidRepoUrlError(): Error {
	return new Error('Invalid private repository SSH URL. Use git@host:owner/repo.git or ssh://git@host[:port]/owner/repo.git with port 1-65535.');
}
