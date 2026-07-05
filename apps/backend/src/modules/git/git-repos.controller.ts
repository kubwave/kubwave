import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { GitInstallationsService } from './git-installations.service.js';
import {
	BindInstallationDto,
	bindInstallationSchema,
	gitInstallationParamSchema,
	gitTeamParamSchema,
	GitInstallationDto,
	GitRepositoryDto,
	TeamGitConnectionDto,
	type BindInstallationInput,
	type GitInstallationParam,
	type GitTeamParam
} from './git-repos.dto.js';

@ApiTags('git')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class GitReposController {
	constructor(private readonly installations: GitInstallationsService) {}

	@Post('teams/:teamId/git/installations')
	@HttpCode(200)
	@ApiOperation({ operationId: 'teamGitInstallationsBind', summary: 'Bind a GitHub App installation to the team' })
	@ApiBody({ type: BindInstallationDto })
	@ApiOkResponse({ type: GitInstallationDto })
	bind(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitTeamParamSchema)) params: GitTeamParam,
		@Body(new ZodValidationPipe(bindInstallationSchema)) body: BindInstallationInput
	): Promise<GitInstallationDto> {
		return this.installations.bindInstallation(userId, params.teamId, body.githubInstallationId);
	}

	@Get('teams/:teamId/git/connection')
	@ApiOperation({ operationId: 'teamGitConnectionGet', summary: 'Whether a GitHub App is connected, plus the install URL' })
	@ApiOkResponse({ type: TeamGitConnectionDto })
	connection(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(gitTeamParamSchema)) params: GitTeamParam): Promise<TeamGitConnectionDto> {
		return this.installations.teamConnection(userId, params.teamId);
	}

	@Get('teams/:teamId/git/installations')
	@ApiOperation({ operationId: 'teamGitInstallationsList', summary: 'List the team’s GitHub installations' })
	@ApiOkResponse({ type: [GitInstallationDto] })
	list(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(gitTeamParamSchema)) params: GitTeamParam): Promise<GitInstallationDto[]> {
		return this.installations.listForTeam(userId, params.teamId);
	}

	@Get('teams/:teamId/git/installations/:installationId/repos')
	@ApiOperation({ operationId: 'teamGitInstallationReposList', summary: 'List repositories available to an installation' })
	@ApiOkResponse({ type: [GitRepositoryDto] })
	repos(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitInstallationParamSchema)) params: GitInstallationParam
	): Promise<GitRepositoryDto[]> {
		return this.installations.listRepos(userId, params.teamId, params.installationId);
	}

	@Post('teams/:teamId/git/installations/:installationId/repos/sync')
	@HttpCode(200)
	@ApiOperation({ operationId: 'teamGitInstallationReposSync', summary: 'Re-sync an installation’s repositories from GitHub' })
	@ApiOkResponse({ type: [GitRepositoryDto] })
	syncRepos(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitInstallationParamSchema)) params: GitInstallationParam
	): Promise<GitRepositoryDto[]> {
		return this.installations.resyncRepos(userId, params.teamId, params.installationId);
	}

	@Delete('teams/:teamId/git/installations/:installationId')
	@HttpCode(204)
	@ApiOperation({ operationId: 'teamGitInstallationsUnbind', summary: 'Unbind a GitHub installation from the team' })
	@ApiNoContentResponse()
	async unbind(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(gitInstallationParamSchema)) params: GitInstallationParam
	): Promise<void> {
		await this.installations.unbind(userId, params.teamId, params.installationId);
	}
}
