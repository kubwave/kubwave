import type { KubeConfig } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { CloudProvider } from '~/lib/cloud-provider.js';
import { UserCancelledError } from '~/lib/errors.js';
import { cloudfleetHetznerDescriptor } from '~/platforms/cloudfleet/hetzner/descriptor.js';
import { cloudfleetGcpDescriptor } from '~/platforms/cloudfleet/gcp/descriptor.js';
import type { DependencyStateInput } from '~/lib/dependency-state.js';

export type StorageOpts = {
	storageMode: 'auto' | 'skip';
	storageClass?: string;
};

export type StorageDecision = {
	storageClass?: string;
	nodeSelector?: Record<string, string>;
};

export interface Platform {
	id: string;
	label: string;
	description: string;
	provider: CloudProvider;
	nodeSelector?: Record<string, string>;
	ensureStorage(kc: KubeConfig, opts: StorageOpts): Promise<StorageDecision>;
	dependencies: DependencyStateInput;
}

export interface PlatformBuildOpts {
	hetznerLbLocation?: string;
}

export interface PlatformDescriptor {
	id: string;
	label: string;
	description: string;
	build(opts: PlatformBuildOpts): Promise<Platform>;
}

export const PLATFORMS: ReadonlyArray<PlatformDescriptor> = [cloudfleetHetznerDescriptor, cloudfleetGcpDescriptor];

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
