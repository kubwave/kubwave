import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { McpAuthService } from './mcp-auth.service.js';
import { accessInputSchema, authorizationSchema, consentSchema, MCP_SCOPES } from './mcp.schemas.js';
import {
	McpAccessDto,
	McpAccessInputDto,
	McpAuthorizationDetailsDto,
	McpAuthorizationDto,
	McpConsentDto,
	McpCreatedAccessDto,
	McpInfoDto,
	McpOkDto,
	McpRedirectDto
} from './mcp.dto.js';

@ApiTags('mcp')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller('mcp')
export class McpController {
	constructor(private readonly auth: McpAuthService) {}

	@Get('info')
	@ApiOperation({ operationId: 'mcpInfoGet', summary: 'Get MCP connection details and available scopes' })
	@ApiOkResponse({ type: McpInfoDto })
	info(): McpInfoDto {
		return { endpoint: this.auth.resource, scopes: [...MCP_SCOPES] };
	}

	@Get('access')
	@ApiOperation({ operationId: 'mcpAccessList', summary: 'List your MCP tokens and OAuth connections' })
	@ApiOkResponse({ type: [McpAccessDto] })
	list(@CurrentUserId() userId: string) {
		return this.auth.listAccess(userId);
	}

	@Post('access')
	@ApiOperation({ operationId: 'mcpAccessCreate', summary: 'Create a personal MCP token; shown once' })
	@ApiBody({ type: McpAccessInputDto })
	@ApiCreatedResponse({ type: McpCreatedAccessDto })
	create(@CurrentUserId() userId: string, @Body(new ZodValidationPipe(accessInputSchema)) body: z.infer<typeof accessInputSchema>) {
		return this.auth.createAccess(userId, body);
	}

	@Delete('access/:accessId')
	@ApiOperation({ operationId: 'mcpAccessRevoke', summary: 'Revoke a personal token or OAuth connection immediately' })
	@ApiOkResponse({ type: McpOkDto })
	async revoke(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(z.object({ accessId: z.string().uuid() }))) params: { accessId: string }
	) {
		await this.auth.revokeAccess(userId, params.accessId);
		return { ok: true };
	}

	@Post('authorization')
	@HttpCode(200)
	@ApiOperation({ operationId: 'mcpAuthorizationGet', summary: 'Validate an OAuth request before displaying consent' })
	@ApiBody({ type: McpAuthorizationDto })
	@ApiOkResponse({ type: McpAuthorizationDetailsDto })
	authorization(@Body(new ZodValidationPipe(authorizationSchema)) body: z.infer<typeof authorizationSchema>) {
		return this.auth.authorizationRequest(body);
	}

	@Post('consent')
	@HttpCode(200)
	@ApiOperation({ operationId: 'mcpConsentCreate', summary: 'Approve or deny an MCP OAuth connection' })
	@ApiBody({ type: McpConsentDto })
	@ApiOkResponse({ type: McpRedirectDto })
	consent(@CurrentUserId() userId: string, @Body(new ZodValidationPipe(consentSchema)) body: z.infer<typeof consentSchema>) {
		return this.auth.consent(userId, body);
	}
}
