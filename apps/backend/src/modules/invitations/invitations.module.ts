import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TeamsModule } from '../teams/teams.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
	imports: [AuthModule, TeamsModule],
	controllers: [InvitationsController],
	providers: [InvitationsService],
	exports: [InvitationsService]
})
export class InvitationsModule {}
