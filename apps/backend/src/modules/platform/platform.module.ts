import { Module } from '@nestjs/common';
import { AdminGuard } from '../../shared/auth/auth.guard.js';
import { PlatformController } from './platform.controller.js';
import { PlatformDeploymentConcurrencySettingsController } from './settings/deployment-concurrency/platform-deployment-concurrency-settings.controller.js';
import { PlatformDeploymentConcurrencySettingsService } from './settings/deployment-concurrency/platform-deployment-concurrency-settings.service.js';
import { PlatformDomainSettingsController } from './settings/domain/platform-domain-settings.controller.js';
import { PlatformDomainSettingsService } from './settings/domain/platform-domain-settings.service.js';
import { PlatformHaSettingsController } from './settings/ha/platform-ha-settings.controller.js';
import { PlatformHaSettingsService } from './settings/ha/platform-ha-settings.service.js';
import { PlatformMetricsSettingsController } from './settings/metrics/platform-metrics-settings.controller.js';
import { PlatformMetricsSettingsService } from './settings/metrics/platform-metrics-settings.service.js';
import { PlatformVolumesController } from './settings/platform-volumes/platform-volumes.controller.js';
import { PlatformVolumesService } from './settings/platform-volumes/platform-volumes.service.js';
import { PlatformPrPreviewSettingsController } from './settings/pr-previews/platform-pr-preview-settings.controller.js';
import { PlatformPrPreviewSettingsService } from './settings/pr-previews/platform-pr-preview-settings.service.js';
import { PlatformRegistrySettingsController } from './settings/registry/platform-registry-settings.controller.js';
import { PlatformRegistrySettingsService } from './settings/registry/platform-registry-settings.service.js';
import { PlatformSmtpSettingsController } from './settings/smtp/platform-smtp-settings.controller.js';
import { PlatformSmtpSettingsService } from './settings/smtp/platform-smtp-settings.service.js';
import { PlatformVolumeAutoscalingSettingsController } from './settings/volume-autoscaling/platform-volume-autoscaling-settings.controller.js';
import { PlatformVolumeAutoscalingSettingsService } from './settings/volume-autoscaling/platform-volume-autoscaling-settings.service.js';
import { PlatformUpdatesController } from './updates/platform-updates.controller.js';
import { PlatformUpdatesService } from './updates/platform-updates.service.js';
import { PlatformUsersController } from './users/platform-users.controller.js';
import { PlatformUsersService } from './users/platform-users.service.js';
import { PlatformVersionService } from './version/platform-version.service.js';

@Module({
	controllers: [
		PlatformController,
		PlatformUsersController,
		PlatformDomainSettingsController,
		PlatformSmtpSettingsController,
		PlatformRegistrySettingsController,
		PlatformMetricsSettingsController,
		PlatformPrPreviewSettingsController,
		PlatformHaSettingsController,
		PlatformDeploymentConcurrencySettingsController,
		PlatformVolumeAutoscalingSettingsController,
		PlatformVolumesController,
		PlatformUpdatesController
	],
	providers: [
		AdminGuard,
		PlatformUsersService,
		PlatformDomainSettingsService,
		PlatformSmtpSettingsService,
		PlatformRegistrySettingsService,
		PlatformMetricsSettingsService,
		PlatformPrPreviewSettingsService,
		PlatformHaSettingsService,
		PlatformDeploymentConcurrencySettingsService,
		PlatformVolumeAutoscalingSettingsService,
		PlatformVolumesService,
		PlatformVersionService,
		PlatformUpdatesService
	]
})
export class PlatformModule {}
