import { buildSharedTraefikValues } from '../cloudfleet/traefik-values.js';

// UpCloud's managed load balancer terminates TLS on port 443 by default when the frontend
// mode is http. Traefik must terminate its own cert-manager-issued TLS, so we force TCP
// passthrough for the websecure frontend. HTTP stays in http mode for ACME HTTP-01 challenges.
const upcloudLoadBalancerConfig = JSON.stringify({
	frontends: [
		{ name: 'web', mode: 'http', port: 80 },
		{ name: 'websecure', mode: 'tcp', port: 443 }
	]
});

export function buildUpcloudTraefikValues(): Record<string, unknown> {
	return buildSharedTraefikValues({
		serviceAnnotations: {
			'service.beta.kubernetes.io/upcloud-load-balancer-config': upcloudLoadBalancerConfig
		}
	});
}
