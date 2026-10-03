import { CustomObjectsApi, type KubeConfig } from '@kubernetes/client-node';
import { FatalCliError } from '~/lib/errors.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';

// k3s deploys its bundled Traefik through this helm-controller HelmChart. While it exists, k3s keeps
// reconciling a Traefik that owns the `traefik` IngressClass and the node's :80/:443 ServiceLB ports,
// so the CLI-managed Traefik (own namespace, TCP port pool) can't be installed next to it.
const BUNDLED_TRAEFIK_CHART = { group: 'helm.cattle.io', version: 'v1', namespace: 'kube-system', plural: 'helmcharts', name: 'traefik' };

export async function assertBundledTraefikDisabled(kc: KubeConfig): Promise<void> {
	try {
		await kc.makeApiClient(CustomObjectsApi).getNamespacedCustomObject(BUNDLED_TRAEFIK_CHART);
	} catch (err) {
		if (isNotFoundError(err)) return;
		throw err;
	}
	throw new FatalCliError(
		[
			'The k3s-bundled Traefik is still enabled (HelmChart kube-system/traefik). kubwave installs and manages its own Traefik, and both cannot share the cluster.',
			'On every k3s server, add `traefik` to the `disable:` list in /etc/rancher/k3s/config.yaml (or start k3s with --disable=traefik) and restart k3s.',
			'Re-run the install once `kubectl -n kube-system get helmchart traefik` reports NotFound.'
		].join('\n')
	);
}
