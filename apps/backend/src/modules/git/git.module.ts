import { Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module.js';
import { GitConnectionController } from './git-connection.controller.js';
import { GitConnectionService } from './git-connection.service.js';
import { GitInstallationsService } from './git-installations.service.js';
import { GitReposController } from './git-repos.controller.js';
import { GithubWebhookController } from './github-webhook.controller.js';
import { GithubWebhookService } from './github-webhook.service.js';
import { GiteaConnectionController } from './gitea-connection.controller.js';
import { GiteaConnectionService } from './gitea-connection.service.js';
import { GiteaInstallationsService } from './gitea-installations.service.js';
import { GiteaReposController } from './gitea-repos.controller.js';
import { GiteaWebhookController } from './gitea-webhook.controller.js';
import { GiteaWebhookService } from './gitea-webhook.service.js';

@Module({
	imports: [TeamsModule],
	controllers: [
		GitConnectionController,
		GithubWebhookController,
		GitReposController,
		GiteaConnectionController,
		GiteaWebhookController,
		GiteaReposController
	],
	providers: [
		GitConnectionService,
		GitInstallationsService,
		GithubWebhookService,
		GiteaConnectionService,
		GiteaInstallationsService,
		GiteaWebhookService
	],
	exports: [GiteaInstallationsService]
})
export class GitModule {}
