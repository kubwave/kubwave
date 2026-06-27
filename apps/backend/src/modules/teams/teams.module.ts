import { Module } from '@nestjs/common';
import { TeamSshKeysController } from './ssh-keys/ssh-keys.controller.js';
import { TeamSshKeysService } from './ssh-keys/ssh-keys.service.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
	controllers: [TeamsController, TeamSshKeysController],
	providers: [TeamsService, TeamSshKeysService],
	exports: [TeamsService, TeamSshKeysService]
})
export class TeamsModule {}
