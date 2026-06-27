import type { Platform, PlatformBuildOpts, PlatformDescriptor } from '~/lib/platforms.js';
import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { promptHetznerOptions } from './options.js';
import { makeCloudfleetStorage } from './storage.js';
import { buildHetznerTraefikValues } from './traefik-overrides.js';

const ID = 'cloudfleet-hetzner';
const LABEL = 'Cloudfleet (Hetzner)';
const DESCRIPTION = 'Cloudfleet-managed Kubernetes auf Hetzner Cloud';
const NODE_SELECTOR = { 'cfke.io/provider': 'hetzner' };

export const cloudfleetHetznerDescriptor: PlatformDescriptor = {
	id: ID,
	label: LABEL,
	description: DESCRIPTION,
	async build(opts: PlatformBuildOpts): Promise<Platform> {
		const hetznerOpts = await promptHetznerOptions({ lbLocation: opts.hetznerLbLocation });
		return {
			id: ID,
			label: LABEL,
			description: DESCRIPTION,
			provider: 'hetzner',
			nodeSelector: NODE_SELECTOR,
			ensureStorage: makeCloudfleetStorage('hetzner'),
			dependencies: {
				traefik: {
					kind: 'traefik',
					namespace: TRAEFIK_NAMESPACE,
					releaseName: 'traefik',
					ingressClassName: 'traefik',
					helmValues: buildHetznerTraefikValues(hetznerOpts)
				}
			}
		};
	}
};
