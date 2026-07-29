import type { CloudfleetHetznerOptions } from './options.js';
import { buildCloudfleetTraefikValues } from '../traefik-values.js';

export const HETZNER_LB_LOCATION_ANNOTATION = 'load-balancer.hetzner.cloud/location';

// The service annotation drives hcloud-ccm (pre-installed on Cloudfleet/Hetzner) to provision a Hetzner LB for the Traefik Service.
export function buildHetznerTraefikValues(opts: CloudfleetHetznerOptions): Record<string, unknown> {
	return buildCloudfleetTraefikValues({
		provider: 'hetzner',
		serviceAnnotations: { [HETZNER_LB_LOCATION_ANNOTATION]: opts.lbLocation }
	});
}
