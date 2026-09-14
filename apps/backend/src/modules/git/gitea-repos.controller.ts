import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { GiteaInstallationsService } from './gitea-installations.service.js';
import { GiteaAccountDto, TeamGiteaConnectionDto } from './gitea-connection.dto.js';
import {
	claimInstallationSchema,
	gitInstallationParamSchema,
	gitTeamParamSchema,
	ClaimInstallationDto,
	GitRepositoryDto,
	type ClaimInstallationInput,
	type GitInstallationParam,
	type GitTeamParam
} from './git-repos.dto.js';

@ApiTags('git')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class GiteaReposController {
	constructor(private readonly installations: GiteaInstallationsService) {}

	@Post('teams/:teamId/git/gitea/installations/claim')
	@HttpCode(200)
	@ApiOperation({ operationId: 'teamGiteaInstallationsClaim', summary: 'Redeem a Gitea OAuth grant to bind the account to the team' })
	@ApiBody({ type: ClaimInstallationDto })
	@ApiOkResponse({ type: GiteaAccountDto })
	claim(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitTeamParamSchema)) params: GitTeamParam,
		@Body(new ZodValidationPipe(claimInstallationSchema)) body: ClaimInstallationInput
	): Promise<GiteaAccountDto> {
		return this.installations.claimAccount(userId, params.teamId, body.grant);
	}

	@Get('teams/:teamId/git/gitea/connection')
	@ApiOperation({ operationId: 'teamGiteaConnectionGet', summary: 'Whether Gitea is connected, plus the authorize URL' })
	@ApiOkResponse({ type: TeamGiteaConnectionDto })
	connection(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitTeamParamSchema)) params: GitTeamParam
	): Promise<TeamGiteaConnectionDto> {
		return this.installations.teamConnection(userId, params.teamId);
	}

	@Get('teams/:teamId/git/gitea/installations')
	@ApiOperation({ operationId: 'teamGiteaInstallationsList', summary: 'List the team’s connected Gitea accounts' })
	@ApiOkResponse({ type: [GiteaAccountDto] })
	list(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(gitTeamParamSchema)) params: GitTeamParam): Promise<GiteaAccountDto[]> {
		return this.installations.listForTeam(userId, params.teamId);
	}

	@Get('teams/:teamId/git/gitea/installations/:installationId/repos')
	@ApiOperation({ operationId: 'teamGiteaInstallationReposList', summary: 'List repositories available to a Gitea account' })
	@ApiOkResponse({ type: [GitRepositoryDto] })
	repos(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitInstallationParamSchema)) params: GitInstallationParam
	): Promise<GitRepositoryDto[]> {
		return this.installations.listRepos(userId, params.teamId, params.installationId);
	}

	@Post('teams/:teamId/git/gitea/installations/:installationId/repos/sync')
	@HttpCode(200)
	@ApiOperation({ operationId: 'teamGiteaInstallationReposSync', summary: 'Re-sync repositories from Gitea' })
	@ApiOkResponse({ type: [GitRepositoryDto] })
	syncRepos(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitInstallationParamSchema)) params: GitInstallationParam
	): Promise<GitRepositoryDto[]> {
		return this.installations.resyncRepos(userId, params.teamId, params.installationId);
	}

	@Delete('teams/:teamId/git/gitea/installations/:installationId')
	@HttpCode(204)
	@ApiOperation({ operationId: 'teamGiteaInstallationsUnbind', summary: 'Unbind a Gitea account from the team' })
	@ApiNoContentResponse()
	async unbind(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitInstallationParamSchema)) params: GitInstallationParam
	): Promise<void> {
		await this.installations.unbind(userId, params.teamId, params.installationId);
	}
}
