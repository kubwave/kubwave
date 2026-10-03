import type { Platform, PlatformDescriptor } from '~/lib/platforms.js';
import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { resolveK3sDnsPolicy } from './dns.js';
import { assertBundledTraefikDisabled } from './preflight.js';
import { ensureK3sStorage } from './storage.js';
import { buildK3sTraefikValues } from './traefik-values.js';

// Self-managed clusters have no cloud autoscaler to drive and no provider node labels, so neither
// ensureAutoscaling nor a nodeSelector applies (node warm-up is skipped without a selector too).
export const k3sDescriptor: PlatformDescriptor = {
	id: 'k3s',
	label: 'k3s',
	description: 'Self-managed k3s cluster (bundled Traefik disabled)',
	async build(): Promise<Platform> {
		return {
			id: 'k3s',
			label: 'k3s',
			description: 'Self-managed k3s cluster (bundled Traefik disabled)',
			preflight: assertBundledTraefikDisabled,
			ensureStorage: ensureK3sStorage,
			resolveDnsPolicy: resolveK3sDnsPolicy,
			dependencies: {
				traefik: {
					kind: 'traefik',
					namespace: TRAEFIK_NAMESPACE,
					releaseName: 'traefik',
					ingressClassName: 'traefik',
					helmValues: buildK3sTraefikValues()
				}
			}
		};
	}
};
