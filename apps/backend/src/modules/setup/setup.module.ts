import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TeamsModule } from '../teams/teams.module.js';
import { RegistryStatusService } from './registry-status.service.js';
import { SetupController } from './setup.controller.js';
import { SetupService } from './setup.service.js';

@Module({
	imports: [AuthModule, TeamsModule],
	controllers: [SetupController],
	providers: [SetupService, RegistryStatusService]
})
export class SetupModule {}
