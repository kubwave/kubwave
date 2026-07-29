import type { Platform, PlatformBuildOpts, PlatformDescriptor } from '~/lib/platforms.js';
import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { buildInfomaniakTraefikValues } from './traefik-values.js';
import { ensureInfomaniakStorage } from './storage.js';

// No ensureAutoscaling: PCK node pools are Cluster-API MachineDeployments driven by Infomaniak's own
// managed cluster-autoscaler, so installing a second one would fight it.
export const infomaniakPckDescriptor: PlatformDescriptor = {
	id: 'infomaniak-pck',
	label: 'Infomaniak (PCK)',
	description: 'Infomaniak Public Cloud Kubernetes (PCK)',
	async build(opts: PlatformBuildOpts): Promise<Platform> {
		return {
			id: 'infomaniak-pck',
			label: 'Infomaniak (PCK)',
			description: 'Infomaniak Public Cloud Kubernetes (PCK)',
			ensureStorage: ensureInfomaniakStorage,
			dependencies: {
				traefik: {
					kind: 'traefik',
					namespace: TRAEFIK_NAMESPACE,
					releaseName: 'traefik',
					ingressClassName: 'traefik',
					helmValues: buildInfomaniakTraefikValues({ floatingNetworkId: opts.infomaniakFloatingNetworkId })
				}
			}
		};
	}
};
