import { Module } from '@nestjs/common';
import { EnvironmentsModule } from '../environments/environments.module.js';
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
	imports: [EnvironmentsModule],
	controllers: [ServicesController, ServiceStatusController, ServiceLogsController, ServiceComposeController, ServiceMetricsController],
	providers: [ServicesService, ServiceStatusService, ServiceLogsService, ServiceMetricsService, PrometheusMetricsService],
	exports: [ServicesService, ServiceStatusService, ServiceLogsService, ServiceMetricsService]
})
export class ServicesModule {}
