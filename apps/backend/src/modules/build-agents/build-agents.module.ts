import { Module } from '@nestjs/common';
import { BuildAgentController, BuildAgentRegistrationController, PlatformBuildAgentsController } from './build-agents.controller.js';
import { BuildAgentsService } from './build-agents.service.js';
import { BuildAgentGuard } from './build-agent.guard.js';

@Module({
	controllers: [BuildAgentController, BuildAgentRegistrationController, PlatformBuildAgentsController],
	providers: [BuildAgentsService, BuildAgentGuard]
})
export class BuildAgentsModule {}
