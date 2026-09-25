import { Body, Controller, Get, Header, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { AuthRateLimitGuard } from '../../shared/throttler/auth-rate-limit.guard.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { McpAuthService } from './mcp-auth.service.js';
import { authorizationSchema, registerClientSchema, revokeSchema, tokenRequestSchema } from './mcp.schemas.js';

@ApiExcludeController()
@UseGuards(AuthRateLimitGuard)
@Controller('mcp/oauth')
export class McpOauthController {
	constructor(private readonly auth: McpAuthService) {}

	@Post('register')
	@Header('Cache-Control', 'no-store')
	register(@Body(new ZodValidationPipe(registerClientSchema)) body: z.infer<typeof registerClientSchema>) {
		return this.auth.registerClient(body);
	}

	@Get('authorize')
	async authorize(@Query(new ZodValidationPipe(authorizationSchema)) query: z.infer<typeof authorizationSchema>, @Res() reply: FastifyReply) {
		await this.auth.authorizationRequest(query);
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
		return reply
			.header('Cache-Control', 'no-store')
			.header('Referrer-Policy', 'no-referrer')
			.redirect(`${this.auth.issuer}/mcp/authorize?${params.toString()}`, 302);
	}

	@Post('token')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@Header('Pragma', 'no-cache')
	token(@Body(new ZodValidationPipe(tokenRequestSchema)) body: z.infer<typeof tokenRequestSchema>) {
		return this.auth.exchange(body);
	}

	@Post('revoke')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	async revoke(@Body(new ZodValidationPipe(revokeSchema)) body: z.infer<typeof revokeSchema>) {
		await this.auth.revokeToken(body.token, body.client_id);
		return {};
	}
}
