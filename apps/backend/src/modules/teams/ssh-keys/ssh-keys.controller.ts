import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import {
	CreateSshKeyDto,
	SshKeyDto,
	SshKeyOkDto,
	createSshKeySchema,
	sshKeyIdParamSchema,
	sshKeyTeamParamSchema,
	type CreateSshKeyInput,
	type SshKeyIdParam,
	type SshKeyTeamParam
} from './ssh-keys.dto.js';
import { TeamSshKeysService } from './ssh-keys.service.js';

@ApiTags('teams')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class TeamSshKeysController {
	constructor(private readonly sshKeys: TeamSshKeysService) {}

	@Get('teams/:teamId/ssh-keys')
	@ApiOperation({ operationId: 'teamSshKeysList', summary: 'List team SSH keys' })
	@ApiOkResponse({ type: [SshKeyDto] })
	listTeamSshKeys(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(sshKeyTeamParamSchema)) params: SshKeyTeamParam
	): Promise<SshKeyDto[]> {
		return this.sshKeys.listTeamSshKeys(userId, params.teamId);
	}

	@Post('teams/:teamId/ssh-keys')
	@ApiOperation({ operationId: 'teamSshKeysCreate', summary: 'Create a team SSH key' })
	@ApiBody({ type: CreateSshKeyDto })
	@ApiCreatedResponse({ type: SshKeyDto })
	createTeamSshKey(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(sshKeyTeamParamSchema)) params: SshKeyTeamParam,
		@Body(new ZodValidationPipe(createSshKeySchema)) body: CreateSshKeyInput
	): Promise<SshKeyDto> {
		return this.sshKeys.createTeamSshKey(userId, params.teamId, body);
	}

	@Delete('teams/:teamId/ssh-keys/:keyId')
	@ApiOperation({ operationId: 'teamSshKeysDelete', summary: 'Delete a team SSH key' })
	@ApiOkResponse({ type: SshKeyOkDto })
	async deleteTeamSshKey(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(sshKeyIdParamSchema)) params: SshKeyIdParam
	): Promise<SshKeyOkDto> {
		await this.sshKeys.deleteTeamSshKey(userId, params.teamId, params.keyId);
		return { ok: true };
	}
}
