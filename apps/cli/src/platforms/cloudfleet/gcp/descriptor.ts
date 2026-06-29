import type { Platform, PlatformBuildOpts, PlatformDescriptor } from '~/lib/platforms.js';
import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { makeCloudfleetStorage } from '../storage.js';
import { buildGcpTraefikValues } from './traefik-overrides.js';

const ID = 'cloudfleet-gcp';
const LABEL = 'Cloudfleet (Google Cloud)';
const DESCRIPTION = 'Cloudfleet-managed Kubernetes auf Google Cloud';
const NODE_SELECTOR = { 'cfke.io/provider': 'gcp' };

export const cloudfleetGcpDescriptor: PlatformDescriptor = {
	id: ID,
	label: LABEL,
	description: DESCRIPTION,
	// GCP has no install-time options; the CCM picks region/LB automatically.
	async build(_opts: PlatformBuildOpts): Promise<Platform> {
		return {
			id: ID,
			label: LABEL,
			description: DESCRIPTION,
			provider: 'gcp',
			nodeSelector: NODE_SELECTOR,
			ensureStorage: makeCloudfleetStorage('gcp'),
			dependencies: {
				traefik: {
					kind: 'traefik',
					namespace: TRAEFIK_NAMESPACE,
					releaseName: 'traefik',
					ingressClassName: 'traefik',
					helmValues: buildGcpTraefikValues()
				}
			}
		};
	}
};
