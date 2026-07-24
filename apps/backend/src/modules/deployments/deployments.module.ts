import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module.js';
import { TeamsModule } from '../teams/teams.module.js';
import { DeploymentsController } from './deployments.controller.js';
import { DeploymentsService } from './deployments.service.js';

@Module({
	imports: [ServicesModule, TeamsModule],
	controllers: [DeploymentsController],
	providers: [DeploymentsService],
	exports: [DeploymentsService]
})
export class DeploymentsModule {}
