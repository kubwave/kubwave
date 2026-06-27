import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CookieService } from '../../shared/cookies/cookie.service.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import {
	SetupInitializeRequestDto,
	SetupInitializeResponseDto,
	SetupStatusResponseDto,
	setupInitializeSchema,
	type SetupInitializeInput
} from './setup.dto.js';
import { SetupService } from './setup.service.js';

@ApiTags('setup')
@Controller('setup')
export class SetupController {
	constructor(
		private readonly cookies: CookieService,
		private readonly setup: SetupService
	) {}

	@Get('status')
	@ApiOperation({ operationId: 'setupStatus', summary: 'Get setup status' })
	@ApiOkResponse({ type: SetupStatusResponseDto })
	status(): Promise<SetupStatusResponseDto> {
		return this.setup.status();
	}

	@Post('initialize')
	@HttpCode(200)
	@ApiOperation({ operationId: 'setupInitialize', summary: 'Create the first admin account' })
	@ApiBody({ type: SetupInitializeRequestDto })
	@ApiOkResponse({ type: SetupInitializeResponseDto })
	async initialize(
		@Body(new ZodValidationPipe(setupInitializeSchema)) body: SetupInitializeInput,
		@Res({ passthrough: true }) reply: FastifyReply
	): Promise<SetupInitializeResponseDto> {
		const result = await this.setup.initialize(body);
		this.cookies.setRefreshToken(reply, result.refreshToken);
		this.cookies.setActiveTeam(reply, result.activeTeamId);
		return { accessToken: result.accessToken, user: result.user };
	}
}
