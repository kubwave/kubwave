// Service type LoadBalancer drives the GCP cloud-controller-manager (pre-installed on Cloudfleet/GCP) to provision a regional external network LB for Traefik.
export function buildGcpTraefikValues(): Record<string, unknown> {
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
			type: 'LoadBalancer'
		},
		nodeSelector: {
			'cfke.io/provider': 'gcp'
		}
	};
}
