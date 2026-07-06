import { Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module.js';
import { GitConnectionController } from './git-connection.controller.js';
import { GitConnectionService } from './git-connection.service.js';
import { GitInstallationsService } from './git-installations.service.js';
import { GitReposController } from './git-repos.controller.js';
import { GithubWebhookController } from './github-webhook.controller.js';
import { GithubWebhookService } from './github-webhook.service.js';

@Module({
	imports: [TeamsModule],
	controllers: [GitConnectionController, GithubWebhookController, GitReposController],
	providers: [GitConnectionService, GitInstallationsService, GithubWebhookService]
})
export class GitModule {}
