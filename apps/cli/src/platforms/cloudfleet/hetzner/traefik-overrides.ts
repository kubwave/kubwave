import type { CloudfleetHetznerOptions } from './options.js';

// The service annotation drives hcloud-ccm (pre-installed on Cloudfleet/Hetzner) to provision a Hetzner LB for the Traefik Service.
export function buildHetznerTraefikValues(opts: CloudfleetHetznerOptions): Record<string, unknown> {
	return {
		deployment: {
			replicas: 2
		},
		podDisruptionBudget: {
			enabled: true,
			minAvailable: 1
		},
		// Soft anti-affinity: spread replicas across nodes for HA/drain when possible, but still schedule both on a single-node fleet.
		affinity: {
			podAntiAffinity: {
				preferredDuringSchedulingIgnoredDuringExecution: [
					{
						weight: 100,
						podAffinityTerm: {
							topologyKey: 'kubernetes.io/hostname',
							labelSelector: {
								matchLabels: { 'app.kubernetes.io/name': 'traefik' }
							}
						}
					}
				]
			}
		},
		service: {
			type: 'LoadBalancer',
			annotations: {
				'load-balancer.hetzner.cloud/location': opts.lbLocation
			}
		},
		nodeSelector: {
			'cfke.io/provider': 'hetzner'
		}
	};
}
