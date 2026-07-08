import type { Platform, PlatformBuildOpts, PlatformDescriptor } from '~/lib/platforms.js';
import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { buildUpcloudTraefikValues } from './traefik-values.js';
import { ensureUpcloudStorage } from './storage.js';
import { ensureUpcloudAutoscaling } from './autoscaling.js';

export const upcloudUksDescriptor: PlatformDescriptor = {
	id: 'upcloud-uks',
	label: 'UpCloud (UKS)',
	description: 'UpCloud Managed Kubernetes (UKS)',
	async build(_opts: PlatformBuildOpts): Promise<Platform> {
		return {
			id: 'upcloud-uks',
			label: 'UpCloud (UKS)',
			description: 'UpCloud Managed Kubernetes (UKS)',
			ensureStorage: ensureUpcloudStorage,
			ensureAutoscaling: ensureUpcloudAutoscaling,
			dependencies: {
				traefik: {
					kind: 'traefik',
					namespace: TRAEFIK_NAMESPACE,
					releaseName: 'traefik',
					ingressClassName: 'traefik',
					helmValues: buildUpcloudTraefikValues()
				}
			}
		};
	}
};
