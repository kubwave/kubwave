import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { AuthRateLimitGuard } from '../../shared/throttler/auth-rate-limit.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { CookieService } from '../../shared/cookies/cookie.service.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { AuthService } from './auth.service.js';
import { LoginRequestDto, LoginResponseDto, RefreshResponseDto, SessionResponseDto, loginSchema, type LoginInput } from './auth.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly cookies: CookieService
	) {}

	@Post('login')
	@UseGuards(AuthRateLimitGuard)
	@HttpCode(200)
	@ApiOperation({ operationId: 'authLogin', summary: 'Log in with email and password' })
	@ApiBody({ type: LoginRequestDto })
	@ApiOkResponse({ type: LoginResponseDto })
	async login(
		@Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
		@Res({ passthrough: true }) reply: FastifyReply
	): Promise<LoginResponseDto> {
		const result = await this.auth.loginWithPassword(body.email, body.password);
		this.cookies.setRefreshToken(reply, result.refreshToken);
		if (result.activeTeamId) this.cookies.setActiveTeam(reply, result.activeTeamId);
		else this.cookies.clearActiveTeam(reply);
		return { accessToken: result.accessToken, user: result.user };
	}

	@Post('logout')
	@HttpCode(200)
	@ApiOperation({ operationId: 'authLogout', summary: 'Log out and revoke the current refresh token' })
	async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
		const refreshToken = this.cookies.getRefreshToken(request);
		if (refreshToken) await this.auth.revokeRefreshToken(refreshToken).catch(() => {});
		this.cookies.clearRefreshToken(reply);
		this.cookies.clearActiveTeam(reply);
		return { ok: true as const };
	}

	@Post('refresh')
	@HttpCode(200)
	@ApiOperation({ operationId: 'authRefresh', summary: 'Rotate refresh token and issue a new access token' })
	@ApiOkResponse({ type: RefreshResponseDto })
	async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<RefreshResponseDto> {
		const refreshToken = this.cookies.getRefreshToken(request);
		if (!refreshToken) {
			this.cookies.clearActiveTeam(reply);
			throw new ApiError(401, 'unauthorized');
		}

		try {
			const rotated = await this.auth.rotateRefreshToken(refreshToken);
			this.cookies.setRefreshToken(reply, rotated.refreshToken);
			return { accessToken: rotated.accessToken };
		} catch (err) {
			if (err instanceof ApiError && err.code === 'unauthorized') {
				this.cookies.clearRefreshToken(reply);
				this.cookies.clearActiveTeam(reply);
			}
			throw err;
		}
	}

	@Get('session')
	@UseGuards(AuthGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'authSession', summary: 'Get the current session user' })
	@ApiOkResponse({ type: SessionResponseDto })
	async session(@CurrentUserId() userId: string): Promise<SessionResponseDto> {
		return { user: await this.auth.getSessionUser(userId) };
	}
}
