import { Body, Controller, Delete, Get, HttpCode, Post, Query, Redirect, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { errorMessage } from '../../shared/worker-common/errors.js';
import { connectGiteaSchema, ConnectGiteaDto, GiteaConnectionDto, type ConnectGiteaInput } from './gitea-connection.dto.js';
import { GiteaConnectionService } from './gitea-connection.service.js';
import { GiteaInstallationsService } from './gitea-installations.service.js';

@ApiTags('git')
@Controller('git/gitea')
export class GiteaConnectionController {
	constructor(
		private readonly connections: GiteaConnectionService,
		private readonly installations: GiteaInstallationsService
	) {}

	@Post()
	@HttpCode(200)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiBody({ type: ConnectGiteaDto })
	@ApiOperation({ operationId: 'gitGiteaConnect', summary: 'Connect a Gitea OAuth application' })
	@ApiOkResponse({ type: GiteaConnectionDto })
	connect(@CurrentUserId() userId: string, @Body(new ZodValidationPipe(connectGiteaSchema)) body: ConnectGiteaInput): Promise<GiteaConnectionDto> {
		return this.connections.connect(body, userId);
	}

	@Get('callback')
	@Redirect()
	@ApiExcludeEndpoint()
	async callback(@Query('code') code?: string, @Query('state') state?: string): Promise<{ url: string }> {
		if (!code || !state) return { url: this.connections.teamSetupRedirect({ git_error: 'missing_code' }) };
		try {
			const grant = await this.installations.completeOAuth(code, state);
			return { url: this.connections.teamSetupRedirect({ git_grant: grant }) };
		} catch (err) {
			return { url: this.connections.teamSetupRedirect({ git_error: errorMessage(err) }) };
		}
	}

	@Get()
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'gitGiteaConnectionGet', summary: 'Get the connected Gitea OAuth application' })
	@ApiOkResponse({ type: GiteaConnectionDto })
	getConnection(): Promise<GiteaConnectionDto> {
		return this.connections.getConnection();
	}

	@Delete()
	@HttpCode(204)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'gitGiteaDisconnect', summary: 'Disconnect the Gitea OAuth application' })
	@ApiNoContentResponse()
	deleteConnection(): Promise<void> {
		return this.connections.deleteConnection();
	}
}
