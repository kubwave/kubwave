import { Controller, Delete, Get, HttpCode, Post, Query, Redirect, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { errorMessage } from '../../shared/worker-common/errors.js';
import { GitConnectionService } from './git-connection.service.js';
import { GithubConnectionDto, GithubManifestDto } from './git-connection.dto.js';

@ApiTags('git')
@Controller('git/github')
export class GitConnectionController {
	constructor(private readonly connections: GitConnectionService) {}

	// `organization` is a query param (not a JSON body) so the console can POST with no body — an empty JSON body otherwise trips validation.
	@Post('manifest')
	@HttpCode(200)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiQuery({ name: 'organization', required: false })
	@ApiOperation({ operationId: 'gitGithubCreateManifest', summary: 'Build a GitHub App manifest and signed state' })
	@ApiOkResponse({ type: GithubManifestDto })
	createManifest(@CurrentUserId() userId: string, @Query('organization') organization?: string): Promise<GithubManifestDto> {
		return this.connections.createManifest(organization?.trim() || undefined, userId);
	}

	// Browser redirect target for the manifest flow: public (no bearer survives a top-level GitHub redirect); the signed `state` is the auth.
	@Get('callback')
	@Redirect()
	@ApiExcludeEndpoint()
	async callback(@Query('code') code?: string, @Query('state') state?: string): Promise<{ url: string }> {
		if (!code || !state) return { url: this.connections.consoleRedirect({ git_error: 'missing_code' }) };
		try {
			await this.connections.completeManifest(code, state);
			return { url: this.connections.consoleRedirect({ connected: '1' }) };
		} catch (err) {
			return { url: this.connections.consoleRedirect({ git_error: errorMessage(err) }) };
		}
	}

	@Get()
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'gitGithubConnectionGet', summary: 'Get the connected GitHub App' })
	@ApiOkResponse({ type: GithubConnectionDto })
	getConnection(): Promise<GithubConnectionDto> {
		return this.connections.getConnection();
	}

	@Delete()
	@HttpCode(204)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'gitGithubDisconnect', summary: 'Disconnect the GitHub App' })
	@ApiNoContentResponse()
	deleteConnection(): Promise<void> {
		return this.connections.deleteConnection();
	}
}
