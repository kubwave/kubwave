import { Injectable } from '@nestjs/common';
import { CoreV1Api } from '@kubernetes/client-node';
import {
	BUILD_REGISTRY_SETTINGS_KEY,
	PLATFORM_CONFIGMAP_NAME,
	buildRegistryConfigured,
	buildRegistryCredentialHash,
	getKubeConfig,
	normalizeBuildRegistrySettings,
	platformRegistryHost,
	type BuildRegistrySettings
} from '@kubwave/kube';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { SettingsService } from '../../shared/settings/settings.service.js';

interface MarkerRegistryState {
	registryMode?: string;
	registryHost?: string;
	registryInsecure?: boolean;
	registryIngressEnabled?: boolean;
	registryCredentialHash?: string;
}

@Injectable()
export class RegistryStatusService {
	constructor(
		private readonly config: BackendConfigService,
		private readonly settings: SettingsService
	) {}

	async isConfigured(): Promise<boolean> {
		const [settings, marker] = await Promise.all([this.getSettings(), this.readMarker()]);
		return buildRegistryConfigured(settings) && this.markerMatchesSettings(marker, settings);
	}

	private async getSettings(): Promise<BuildRegistrySettings> {
		return normalizeBuildRegistrySettings(await this.settings.get<unknown>(BUILD_REGISTRY_SETTINGS_KEY));
	}

	private async readMarker(): Promise<MarkerRegistryState | null> {
		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);
			const cm = await coreApi.readNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace: this.config.api.podNamespace });
			const data = cm.data ?? {};
			return {
				registryMode: data['registry_mode'],
				registryHost: data['registry_host'],
				registryInsecure: data['registry_insecure'] === 'true',
				registryIngressEnabled: data['registry_ingress_enabled'] === 'true',
				registryCredentialHash: data['registry_credential_hash']
			};
		} catch {
			return null;
		}
	}

	private markerMatchesSettings(marker: MarkerRegistryState | null, settings: BuildRegistrySettings): boolean {
		if (!marker) return false;
		if (settings.mode === 'unconfigured') return marker.registryMode === 'unconfigured';
		if (settings.mode === 'platform') {
			return (
				marker.registryMode === 'platform' &&
				marker.registryHost === platformRegistryHost(this.platformDomain()) &&
				marker.registryIngressEnabled === true
			);
		}
		return (
			marker.registryMode === 'external' &&
			marker.registryHost === settings.endpoint &&
			marker.registryInsecure === settings.insecure &&
			marker.registryCredentialHash === buildRegistryCredentialHash(settings)
		);
	}

	private platformDomain(): string {
		try {
			return new URL(this.config.api.appBaseUrl).host;
		} catch {
			return this.config.api.appBaseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		}
	}
}
