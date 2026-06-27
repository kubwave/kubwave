import { Injectable } from '@nestjs/common';
import { DEPLOYMENT_CONCURRENCY_SETTINGS_KEY, resolveDeploymentConcurrencySettings, type DeploymentConcurrencySettings } from '@kubwave/kube';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { DeploymentConcurrencySettingsDto, UpdateDeploymentConcurrencySettingsInput } from './platform-deployment-concurrency-settings.dto.js';

@Injectable()
export class PlatformDeploymentConcurrencySettingsService {
	constructor(private readonly settings: SettingsService) {}

	async getSettings(): Promise<DeploymentConcurrencySettingsDto> {
		return resolveDeploymentConcurrencySettings(await this.settings.get<Partial<DeploymentConcurrencySettings>>(DEPLOYMENT_CONCURRENCY_SETTINGS_KEY));
	}

	async updateSettings(input: UpdateDeploymentConcurrencySettingsInput): Promise<DeploymentConcurrencySettingsDto> {
		await this.settings.set<DeploymentConcurrencySettings>(DEPLOYMENT_CONCURRENCY_SETTINGS_KEY, {
			maxConcurrentDeployments: input.maxConcurrentDeployments
		});
		return this.getSettings();
	}
}
