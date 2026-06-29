import { buildCloudfleetTraefikValues } from '../traefik-values.js';

// Service type LoadBalancer drives the GCP cloud-controller-manager (pre-installed on Cloudfleet/GCP) to
// provision a regional external network LB for Traefik. No service annotations needed.
export function buildGcpTraefikValues(): Record<string, unknown> {
	return buildCloudfleetTraefikValues({ provider: 'gcp' });
}
