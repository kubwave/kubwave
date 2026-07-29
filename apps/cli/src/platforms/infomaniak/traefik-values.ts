import { buildSharedTraefikValues } from '../cloudfleet/traefik-values.js';

export const OPENSTACK_FLOATING_NETWORK_ANNOTATION = 'loadbalancer.openstack.org/floating-network-id';

// PCK runs the OpenStack CCM with Octavia, which derives one listener per Service port on its own —
// no listener manifest annotation is needed (unlike UpCloud). Only the floating-IP network has to be
// named explicitly, and only on projects where Octavia has no default external network configured.
export function buildInfomaniakTraefikValues(opts: { floatingNetworkId?: string } = {}): Record<string, unknown> {
	return buildSharedTraefikValues(
		opts.floatingNetworkId ? { serviceAnnotations: { [OPENSTACK_FLOATING_NETWORK_ANNOTATION]: opts.floatingNetworkId } } : {}
	);
}
