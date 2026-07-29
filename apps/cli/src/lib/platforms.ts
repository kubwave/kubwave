import type { KubeConfig } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { CloudProvider } from '~/lib/cloud-provider.js';
import { UserCancelledError } from '~/lib/errors.js';
import { cloudfleetHetznerDescriptor } from '~/platforms/cloudfleet/hetzner/descriptor.js';
import { cloudfleetGcpDescriptor } from '~/platforms/cloudfleet/gcp/descriptor.js';
import { upcloudUksDescriptor } from '~/platforms/upcloud/descriptor.js';
import { infomaniakPckDescriptor } from '~/platforms/infomaniak/descriptor.js';
import { mergeDependencyState, withTcpPortPool, type DependencyStateInput, type DependencyStateMap } from '~/lib/dependency-state.js';
import { buildUpcloudTraefikValues } from '~/platforms/upcloud/traefik-values.js';
import { buildInfomaniakTraefikValues, OPENSTACK_FLOATING_NETWORK_ANNOTATION } from '~/platforms/infomaniak/traefik-values.js';
import { buildGcpTraefikValues } from '~/platforms/cloudfleet/gcp/traefik-overrides.js';
import { HETZNER_LB_LOCATION_ANNOTATION } from '~/platforms/cloudfleet/hetzner/traefik-overrides.js';
import { buildCloudfleetTraefikValues } from '~/platforms/cloudfleet/traefik-values.js';
import { readString } from '~/lib/object-path.js';
import type { TcpPortPoolSettings } from '@kubwave/kube';

export type StorageOpts = {
	storageMode: 'auto' | 'skip';
	storageClass?: string;
	assumeYes?: boolean;
};

export type StorageDecision = {
	storageClass?: string;
	nodeSelector?: Record<string, string>;
};

export type UpcloudNodeGroup = {
	name: string;
	min: number;
	max: number;
};

export type AutoscalingOpts = {
	upcloudAutoscaling?: boolean;
	upcloudClusterUuid?: string;
	upcloudToken?: string;
	upcloudUsername?: string;
	upcloudPassword?: string;
	upcloudNodeGroups?: UpcloudNodeGroup[];
	upcloudAutoscalerImageTag?: string;
	assumeYes?: boolean;
};

export type AutoscalingDecision = {
	enabled: boolean;
	clusterUuid: string;
	nodeGroups?: UpcloudNodeGroup[];
};

export interface Platform {
	id: string;
	label: string;
	description: string;
	provider?: CloudProvider;
	nodeSelector?: Record<string, string>;
	ensureStorage(kc: KubeConfig, opts: StorageOpts): Promise<StorageDecision>;
	ensureAutoscaling?: (kc: KubeConfig, opts: AutoscalingOpts) => Promise<AutoscalingDecision | void>;
	dependencies: DependencyStateInput;
}

export interface PlatformBuildOpts {
	hetznerLbLocation?: string;
	infomaniakFloatingNetworkId?: string;
	assumeYes?: boolean;
}

export interface PlatformDescriptor {
	id: string;
	label: string;
	description: string;
	build(opts: PlatformBuildOpts): Promise<Platform>;
}

export const PLATFORMS: ReadonlyArray<PlatformDescriptor> = [
	cloudfleetHetznerDescriptor,
	cloudfleetGcpDescriptor,
	upcloudUksDescriptor,
	infomaniakPckDescriptor
];

export function getPlatformDescriptor(id: string): PlatformDescriptor {
	const found = PLATFORMS.find(descriptor => descriptor.id === id);
	if (!found) {
		const available = PLATFORMS.map(descriptor => descriptor.id).join(', ');
		throw new Error(`Unknown platform "${id}". Available: ${available}`);
	}
	return found;
}

export async function selectPlatform(opts: { platform?: string } & PlatformBuildOpts): Promise<Platform> {
	const descriptor = await pickDescriptor(opts);
	return descriptor.build(opts);
}

// Rebuild the default Traefik helm values for a known platform. Upgrades use this so fixes to
// platform-specific service annotations (e.g. UpCloud TCP passthrough) are applied even when the
// marker was created by an older CLI version. Existing Hetzner annotations are preserved.
export function defaultTraefikValuesForPlatform(
	platformId: string,
	existingValues?: Record<string, unknown>,
	tcpPortPool?: TcpPortPoolSettings
): Record<string, unknown> | undefined {
	switch (platformId) {
		case 'upcloud-uks':
			return buildUpcloudTraefikValues(tcpPortPool);
		case 'cloudfleet-gcp':
			return buildGcpTraefikValues();
		case 'infomaniak-pck':
			return buildInfomaniakTraefikValues({
				floatingNetworkId: readString(existingValues, ['service', 'annotations', OPENSTACK_FLOATING_NETWORK_ANNOTATION])
			});
		case 'cloudfleet-hetzner': {
			const lbLocation = readString(existingValues, ['service', 'annotations', HETZNER_LB_LOCATION_ANNOTATION]);
			return buildCloudfleetTraefikValues({
				provider: 'hetzner',
				...(lbLocation ? { serviceAnnotations: { [HETZNER_LB_LOCATION_ANNOTATION]: lbLocation } } : {})
			});
		}
		default:
			return undefined;
	}
}

export function withPlatformTcpPortPool(
	dependencies: DependencyStateInput | DependencyStateMap,
	platformId: string,
	pool: TcpPortPoolSettings
): DependencyStateMap {
	const resolved = mergeDependencyState(dependencies);
	const current = resolved.traefik.helmValues;
	const platformValues = defaultTraefikValuesForPlatform(platformId, current, pool);
	const withPlatformValues = platformValues ? { ...resolved, traefik: { ...resolved.traefik, helmValues: platformValues } } : resolved;
	return withTcpPortPool(withPlatformValues, pool);
}

async function pickDescriptor(opts: { platform?: string }): Promise<PlatformDescriptor> {
	if (opts.platform) {
		return getPlatformDescriptor(opts.platform);
	}
	const choice = await p.select({
		message: 'Welche Kubernetes-Platform installierst du auf?',
		options: PLATFORMS.map(descriptor => ({ value: descriptor.id, label: descriptor.label, hint: descriptor.description }))
	});
	if (p.isCancel(choice)) {
		throw new UserCancelledError('Platform selection aborted.');
	}
	return getPlatformDescriptor(choice);
}
