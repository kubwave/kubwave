import { Module } from '@nestjs/common';
import { EnvironmentsController } from './environments.controller.js';
import { EnvironmentsService } from './environments.service.js';
import { FlowLayoutController } from './flow-layout/flow-layout.controller.js';
import { FlowLayoutService } from './flow-layout/flow-layout.service.js';

@Module({
	controllers: [EnvironmentsController, FlowLayoutController],
	providers: [EnvironmentsService, FlowLayoutService],
	exports: [EnvironmentsService, FlowLayoutService]
})
export class EnvironmentsModule {}
