import { buildSharedTraefikValues } from '../cloudfleet/traefik-values.js';

// k3s ServiceLB (klipper-lb) publishes every LoadBalancer Service port as a host port on the nodes and reports
// the node IPs as the Service's external IPs, so the shared values need no provider annotations here.
export function buildK3sTraefikValues(): Record<string, unknown> {
	return buildSharedTraefikValues({});
}
