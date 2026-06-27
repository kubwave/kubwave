import type { CoreV1Api } from '@kubernetes/client-node';

// Best-effort CNI check from kube-system pods (Cilium/Calico enforce, flannel doesn't); errors swallowed so the worker still starts.

const FLANNEL_MARKERS = ['flannel'];
const ENFORCING_MARKERS = ['cilium', 'calico'];

export interface CniEnforcement {
	// true = enforcing CNI found; false = known non-enforcing (flannel); null = unrecognised.
	enforced: boolean | null;
	cni: string | null;
}

export async function detectNetworkPolicyEnforcement(coreApi: CoreV1Api): Promise<CniEnforcement> {
	const pods = await coreApi.listNamespacedPod({ namespace: 'kube-system' });
	const names = pods.items.map(p => p.metadata?.name ?? '').filter(Boolean);
	const match = (markers: string[]): string | null => names.find(n => markers.some(m => n.includes(m))) ?? null;

	const enforcing = match(ENFORCING_MARKERS);
	if (enforcing) return { enforced: true, cni: enforcing };
	const flannel = match(FLANNEL_MARKERS);
	if (flannel) return { enforced: false, cni: flannel };
	return { enforced: null, cni: null };
}

// Warn when egress isolation is on but the CNI won't enforce it; call only when egress isolation is on (Pod Security needs no CNI guard).
export async function warnIfNetworkPolicyUnenforced(coreApi: CoreV1Api): Promise<void> {
	try {
		const { enforced, cni } = await detectNetworkPolicyEnforcement(coreApi);

		if (enforced === false) {
			console.warn(
				`[startup] tenant egress isolation is ENABLED but the cluster CNI (${cni}) does NOT enforce NetworkPolicy - ` +
					'tenant pods are NOT network-isolated. Deploy a policy-enforcing CNI (Cilium/Calico) for the isolation to take effect.'
			);
		} else if (enforced === null) {
			console.warn(
				'[startup] tenant egress isolation is ENABLED but the cluster CNI could not be identified from kube-system - ' +
					'confirm it enforces NetworkPolicy, or tenant network isolation may be silently ineffective.'
			);
		} else {
			console.log(`[startup] tenant egress isolation enabled; CNI ${cni} enforces NetworkPolicy.`);
		}
	} catch (err) {
		console.warn('[startup] could not verify NetworkPolicy enforcement (continuing):', err instanceof Error ? err.message : String(err));
	}
}
