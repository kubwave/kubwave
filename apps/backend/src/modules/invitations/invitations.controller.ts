import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AdminGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { CookieService } from '../../shared/cookies/cookie.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import {
	AcceptInviteDto,
	AcceptInviteResponseDto,
	CreateInviteDto,
	CreateInviteResultDto,
	InvitationDto,
	InviteOkDto,
	InviteValidityDto,
	acceptInviteSchema,
	createInviteSchema,
	inviteIdParamSchema,
	inviteTokenParamSchema,
	type AcceptInviteInput,
	type CreateInviteInput,
	type InviteIdParam,
	type InviteTokenParam
} from './invitations.dto.js';
import { InviteNotFoundError } from './invitations.errors.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
	constructor(
		private readonly cookies: CookieService,
		private readonly invitations: InvitationsService
	) {}

	@Get()
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'invitationsList', summary: 'List invitations' })
	@ApiOkResponse({ type: [InvitationDto] })
	listInvitations(): Promise<InvitationDto[]> {
		return this.invitations.listInvitations();
	}

	@Post()
	@HttpCode(200)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'invitationsCreate', summary: 'Create an invitation' })
	@ApiBody({ type: CreateInviteDto })
	@ApiOkResponse({ type: CreateInviteResultDto })
	createInvitation(
		@CurrentUserId() userId: string,
		@Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput
	): Promise<CreateInviteResultDto> {
		return this.invitations.createInvitation(body, userId);
	}

	@Delete(':id')
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'invitationsDelete', summary: 'Revoke an invitation' })
	@ApiOkResponse({ type: InviteOkDto })
	async revokeInvitation(@Param(new ZodValidationPipe(inviteIdParamSchema)) params: InviteIdParam): Promise<InviteOkDto> {
		await this.invitations.revokeInvitation(params.id);
		return { ok: true };
	}

	@Post(':id/resend')
	@HttpCode(200)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'invitationsResend', summary: 'Resend an invitation' })
	@ApiOkResponse({ type: CreateInviteResultDto })
	resendInvitation(@Param(new ZodValidationPipe(inviteIdParamSchema)) params: InviteIdParam): Promise<CreateInviteResultDto> {
		return this.invitations.resendInvitation(params.id);
	}

	@Get(':id/validity')
	@ApiOperation({ operationId: 'invitationsValidity', summary: 'Check invitation token validity' })
	@ApiOkResponse({ type: InviteValidityDto })
	checkInviteValidity(@Param(new ZodValidationPipe(inviteTokenParamSchema)) params: InviteTokenParam): Promise<InviteValidityDto> {
		return this.invitations.checkInviteValidity(params.id);
	}

	@Post(':id/accept')
	@HttpCode(200)
	@ApiOperation({ operationId: 'invitationsAccept', summary: 'Accept an invitation and log in' })
	@ApiBody({ type: AcceptInviteDto })
	@ApiOkResponse({ type: AcceptInviteResponseDto })
	async acceptInvitation(
		@Param(new ZodValidationPipe(inviteTokenParamSchema)) params: InviteTokenParam,
		@Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
		@Res({ passthrough: true }) reply: FastifyReply
	): Promise<AcceptInviteResponseDto> {
		try {
			const result = await this.invitations.acceptInvitation({ token: params.id, ...body });
			this.cookies.setRefreshToken(reply, result.refreshToken);
			this.cookies.setActiveTeam(reply, result.activeTeamId);
			return { accessToken: result.accessToken, user: result.user };
		} catch (err) {
			if (err instanceof InviteNotFoundError) throw new ApiError(409, 'invite_not_found');
			throw err;
		}
	}
}
