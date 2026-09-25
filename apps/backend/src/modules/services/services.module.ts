import { Module } from '@nestjs/common';
import { EnvironmentsModule } from '../environments/environments.module.js';
import { GitModule } from '../git/git.module.js';
import { ServiceAnalyzeController } from './analyze/analyze.controller.js';
import { ServiceAnalyzeService } from './analyze/analyze.service.js';
import { ServiceComposeController } from './compose/compose.controller.js';
import { ServiceLogsController } from './logs/logs.controller.js';
import { ServiceLogsService } from './logs/logs.service.js';
import { ServiceMetricsController } from './metrics/metrics.controller.js';
import { ServiceMetricsService } from './metrics/metrics.service.js';
import { PrometheusMetricsService } from './metrics/prometheus.service.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';
import { ServiceStatusController } from './status/status.controller.js';
import { ServiceStatusService } from './status/status.service.js';

@Module({
	imports: [EnvironmentsModule, GitModule],
	controllers: [
		ServicesController,
		ServiceStatusController,
		ServiceLogsController,
		ServiceComposeController,
		ServiceAnalyzeController,
		ServiceMetricsController
	],
	providers: [ServicesService, ServiceStatusService, ServiceLogsService, ServiceMetricsService, PrometheusMetricsService, ServiceAnalyzeService],
	exports: [ServicesService, ServiceStatusService, ServiceLogsService, ServiceMetricsService]
})
export class ServicesModule {}
