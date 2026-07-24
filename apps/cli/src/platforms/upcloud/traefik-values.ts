import { buildSharedTraefikValues } from '../cloudfleet/traefik-values.js';
import { TCP_PORT_POOL } from '~/lib/traefik.js';
import type { TcpPortPoolSettings } from '@kubwave/kube';

// UpCloud's managed load balancer requires every public listener in its frontend annotation.
// Keep websecure and the raw TCP pool in passthrough mode so Traefik owns their protocols.
export function buildUpcloudTraefikValues(pool: TcpPortPoolSettings = TCP_PORT_POOL): Record<string, unknown> {
	const frontends = [
		{ name: 'web', mode: 'http', port: 80 },
		{ name: 'websecure', mode: 'tcp', port: 443 },
		...(pool.enabled
			? Array.from({ length: pool.size }, (_, index) => {
					const port = pool.start + index;
					return { name: `tcp-${port}`, mode: 'tcp', port };
				})
			: [])
	];
	return buildSharedTraefikValues({
		serviceAnnotations: {
			'service.beta.kubernetes.io/upcloud-load-balancer-config': JSON.stringify({ frontends })
		}
	});
}
