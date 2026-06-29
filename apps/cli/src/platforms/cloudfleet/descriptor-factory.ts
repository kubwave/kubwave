import type { Platform, PlatformBuildOpts, PlatformDescriptor } from '~/lib/platforms.js';
import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { cfkeNodeSelector, type CloudProvider } from '~/lib/cloud-provider.js';
import { makeCloudfleetStorage } from './storage.js';

export interface CloudfleetDescriptorSpec {
	id: string;
	label: string;
	description: string;
	provider: CloudProvider;
	// Builds the Traefik helm values for this provider; may prompt (Hetzner) so it's async-capable.
	buildTraefikValues: (opts: PlatformBuildOpts) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

// Every Cloudfleet provider builds the same Platform/Traefik-dependency shape; they differ only in id/label,
// the provider node pin, and how the Traefik values are produced. This factory is the single place that
// assembly lives so a new field (or a new provider) is wired once, not copied per descriptor.
export function makeCloudfleetDescriptor(spec: CloudfleetDescriptorSpec): PlatformDescriptor {
	const { id, label, description, provider } = spec;
	return {
		id,
		label,
		description,
		async build(opts: PlatformBuildOpts): Promise<Platform> {
			return {
				id,
				label,
				description,
				provider,
				nodeSelector: cfkeNodeSelector(provider),
				ensureStorage: makeCloudfleetStorage(provider),
				dependencies: {
					traefik: {
						kind: 'traefik',
						namespace: TRAEFIK_NAMESPACE,
						releaseName: 'traefik',
						ingressClassName: 'traefik',
						helmValues: await spec.buildTraefikValues(opts)
					}
				}
			};
		}
	};
}
