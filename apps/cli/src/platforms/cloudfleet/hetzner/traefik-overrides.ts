import type { CloudfleetHetznerOptions } from './options.js';
import { buildCloudfleetTraefikValues } from '../traefik-values.js';

// The service annotation drives hcloud-ccm (pre-installed on Cloudfleet/Hetzner) to provision a Hetzner LB for the Traefik Service.
export function buildHetznerTraefikValues(opts: CloudfleetHetznerOptions): Record<string, unknown> {
	return buildCloudfleetTraefikValues({
		provider: 'hetzner',
		serviceAnnotations: { 'load-balancer.hetzner.cloud/location': opts.lbLocation }
	});
}
