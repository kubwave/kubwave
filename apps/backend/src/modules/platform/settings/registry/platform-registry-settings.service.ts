import { Injectable } from '@nestjs/common';
import { CoreV1Api } from '@kubernetes/client-node';
import { encryptSecret } from '@kubwave/crypto';
import {
	BUILD_REGISTRY_SETTINGS_KEY,
	PLATFORM_CONFIGMAP_NAME,
	buildRegistryCredentialHash,
	buildRegistryConfigured,
	getKubeConfig,
	normalizeBuildRegistrySettings,
	parseBuildRegistryEndpoint,
	platformRegistryHost,
	type BuildRegistrySettings
} from '@kubwave/kube';
import { BackendConfigService } from '../../../../shared/config/backend-config.service.js';
import { ApiError } from '../../../../shared/errors/api-error.js';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { RegistrySettingsDto, UpdateRegistrySettingsInput } from './platform-registry-settings.dto.js';

interface MarkerRegistryState {
	registryMode?: string;
	registryHost?: string;
	registryInsecure?: boolean;
	registryIngressEnabled?: boolean;
	registryCredentialHash?: string;
	registryApplyMode?: string;
	registryApplyError?: string;
	registryApplyFingerprint?: string;
}

@Injectable()
export class PlatformRegistrySettingsService {
	constructor(
		private readonly config: BackendConfigService,
		private readonly settings: SettingsService
	) {}

	async getSettings(): Promise<RegistrySettingsDto> {
		const [settings, marker] = await Promise.all([this.getBuildRegistrySettings(), this.readMarkerRegistryState()]);
		return this.toRegistrySettingsView(settings, marker);
	}

	async updateSettings(input: UpdateRegistrySettingsInput): Promise<RegistrySettingsDto> {
		const existing = await this.getBuildRegistrySettings();
		const next = this.buildNextSettings(input, existing);
		await this.settings.set<BuildRegistrySettings>(BUILD_REGISTRY_SETTINGS_KEY, next);
		return this.getSettings();
	}

	async isBuildRegistryConfigured(): Promise<boolean> {
		const [settings, marker] = await Promise.all([this.getBuildRegistrySettings(), this.readMarkerRegistryState()]);
		return buildRegistryConfigured(settings) && this.markerMatchesSettings(marker, settings);
	}

	private async getBuildRegistrySettings(): Promise<BuildRegistrySettings> {
		return normalizeBuildRegistrySettings(await this.settings.get<unknown>(BUILD_REGISTRY_SETTINGS_KEY));
	}

	private buildNextSettings(input: UpdateRegistrySettingsInput, existing: BuildRegistrySettings): BuildRegistrySettings {
		if (input.mode === 'platform') return { mode: 'platform' };

		let parsed;
		try {
			parsed = parseBuildRegistryEndpoint(input.endpoint);
		} catch (err) {
			throw new ApiError(400, 'invalid_registry_endpoint', { message: err instanceof Error ? err.message : String(err) });
		}

		const passwordCiphertext = input.password
			? encryptSecret(input.password)
			: existing.mode === 'external'
				? existing.passwordCiphertext
				: undefined;
		if (!passwordCiphertext) throw new ApiError(400, 'registry_password_required');

		return {
			mode: 'external',
			endpoint: parsed.endpoint,
			insecure: input.insecure,
			username: input.username.trim(),
			passwordCiphertext
		};
	}

	private async readMarkerRegistryState(): Promise<MarkerRegistryState | null> {
		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);
			const cm = await coreApi.readNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace: this.config.api.podNamespace });
			const data = cm.data ?? {};
			return {
				registryMode: data['registry_mode'],
				registryHost: data['registry_host'],
				registryInsecure: data['registry_insecure'] === 'true',
				registryIngressEnabled: data['registry_ingress_enabled'] === 'true',
				registryCredentialHash: data['registry_credential_hash'],
				registryApplyMode: data['registry_apply_mode'],
				registryApplyError: data['registry_apply_error'],
				registryApplyFingerprint: data['registry_apply_fingerprint']
			};
		} catch {
			return null;
		}
	}

	private toRegistrySettingsView(settings: BuildRegistrySettings, marker: MarkerRegistryState | null): RegistrySettingsDto {
		const applied = this.markerMatchesSettings(marker, settings);
		const endpoint = this.registryEndpoint(settings);
		const applyError = this.markerErrorMatchesSettings(marker, settings) ? marker?.registryApplyError : undefined;
		const applyStatus = settings.mode === 'unconfigured' ? 'not_configured' : applied ? 'applied' : applyError ? 'failed' : 'pending';

		return {
			mode: settings.mode,
			endpoint,
			insecure: settings.mode === 'external' ? settings.insecure : false,
			username: settings.mode === 'external' ? settings.username : null,
			hasPassword: settings.mode === 'external' && Boolean(settings.passwordCiphertext),
			applyStatus,
			activeRunId: null,
			lastError: applyStatus === 'failed' ? (applyError ?? 'Registry apply failed.') : null
		};
	}

	private registryEndpoint(settings: BuildRegistrySettings): string | null {
		if (settings.mode === 'external') return settings.endpoint;
		if (settings.mode === 'platform') return platformRegistryHost(this.platformDomain());
		return null;
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

	private markerErrorMatchesSettings(marker: MarkerRegistryState | null, settings: BuildRegistrySettings): boolean {
		if (!marker?.registryApplyError || marker.registryApplyMode !== settings.mode) return false;
		if (settings.mode !== 'external') return true;
		if (!marker.registryApplyFingerprint) return true;
		return marker.registryApplyFingerprint === buildRegistryCredentialHash(settings);
	}
}
