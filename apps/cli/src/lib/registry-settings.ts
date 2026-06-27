import type { KubeConfig } from '@kubernetes/client-node';
import {
	BUILD_REGISTRY_SETTINGS_KEY,
	buildRegistryEndpointHost,
	normalizeBuildRegistrySettings,
	platformRegistryHost,
	type BuildRegistrySettings
} from '@kubwave/kube';
import { decryptSecret } from '@kubwave/crypto';
import { createRegistryPushSecret, createRegistrySecrets } from '~/lib/secrets.js';
import { getJsonSetting } from '~/lib/db.js';
import type { ProgressReporter } from '~/lib/progress.js';
import type { InstallState } from '~/lib/install-state.js';

export async function readDesiredBuildRegistrySettings(): Promise<BuildRegistrySettings | null> {
	const value = await getJsonSetting<unknown>(BUILD_REGISTRY_SETTINGS_KEY);
	return value === null ? null : normalizeBuildRegistrySettings(value);
}

export function applyDesiredBuildRegistry(state: InstallState, desired: BuildRegistrySettings | null): InstallState {
	if (!desired) return state;

	if (desired.mode === 'unconfigured') {
		return {
			...state,
			registryHost: '',
			registryMode: 'unconfigured',
			registryInsecure: false,
			registryIngressEnabled: false,
			registryClusterIssuer: undefined
		};
	}

	if (desired.mode === 'external') {
		return {
			...state,
			registryHost: desired.endpoint,
			registryMode: 'external',
			registryInsecure: desired.insecure,
			registryIngressEnabled: false,
			registryClusterIssuer: undefined
		};
	}

	return {
		...state,
		registryHost: platformRegistryHost(state.domain),
		registryMode: 'platform',
		registryInsecure: false,
		registryIngressEnabled: true,
		registryClusterIssuer: state.registryClusterIssuer ?? state.clusterIssuerName
	};
}

export async function ensureDesiredBuildRegistrySecrets(
	kc: KubeConfig,
	desired: BuildRegistrySettings | null,
	state: InstallState,
	reporter: ProgressReporter
): Promise<void> {
	if (!desired || desired.mode === 'unconfigured') return;

	if (desired.mode === 'platform') {
		reporter.start('Ensuring platform registry secrets...');
		await createRegistrySecrets(kc, buildRegistryEndpointHost(state.registryHost));
		reporter.succeed('Platform registry secrets ready');
		return;
	}

	if (!desired.passwordCiphertext) {
		throw new Error('External registry password is not configured');
	}

	reporter.start('Ensuring external registry push secret...');
	await createRegistryPushSecret(kc, buildRegistryEndpointHost(desired.endpoint), desired.username, decryptSecret(desired.passwordCiphertext));
	reporter.succeed('External registry push secret ready');
}
