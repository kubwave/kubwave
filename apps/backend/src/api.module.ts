import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { DeploymentsModule } from './modules/deployments/deployments.module.js';
import { EnvironmentsModule } from './modules/environments/environments.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { SetupModule } from './modules/setup/setup.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { SharedModule } from './shared/shared.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';

@Module({
	imports: [
		SharedModule,
		HealthModule,
		AuthModule,
		SetupModule,
		TeamsModule,
		ProjectsModule,
		EnvironmentsModule,
		ServicesModule,
		DeploymentsModule,
		InvitationsModule,
		PlatformModule,
		TemplatesModule
	]
})
export class ApiModule {}
