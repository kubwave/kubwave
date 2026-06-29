import { cfkeNodeSelector, type CloudProvider } from '~/lib/cloud-provider.js';

export interface CloudfleetTraefikOpts {
	provider: CloudProvider;
	// Service annotations that steer the provider's CCM (e.g. Hetzner LB location). GCP needs none.
	serviceAnnotations?: Record<string, string>;
}

// Shared Traefik HA values for all Cloudfleet providers. A Service of type LoadBalancer drives each cloud's
// pre-installed cloud-controller-manager to provision an external LB; providers differ only in the node pin
// and the service annotations. Keep provider-specific knobs in the thin wrappers, not here.
export function buildCloudfleetTraefikValues({ provider, serviceAnnotations }: CloudfleetTraefikOpts): Record<string, unknown> {
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
			...(serviceAnnotations ? { annotations: serviceAnnotations } : {})
		},
		nodeSelector: cfkeNodeSelector(provider)
	};
}
