import { CoreV1Api } from '@kubernetes/client-node';
import { getKubeConfig } from '@kubwave/kube';
import { warnIfNetworkPolicyUnenforced } from '../../../shared/cluster/cni.js';
import { tenantIsolation } from '../../../shared/cluster/isolation.js';

export function runStartupChecks(): void {
	// Warn if egress isolation is on but the CNI won't enforce it (e.g. flannel on k3d).
	// Fire-and-forget: must not block or crash startup.
	if (tenantIsolation.egress) {
		void warnIfNetworkPolicyUnenforced(getKubeConfig().makeApiClient(CoreV1Api));
	}
}
