import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../shared/auth/auth.guard.js';
import { AuthRateLimitGuard } from '../../shared/throttler/auth-rate-limit.guard.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { BuildAgentsService } from './build-agents.service.js';
import { BuildAgentGuard, type AgentRequest } from './build-agent.guard.js';
import {
	BuildAgentDto,
	CreateBuildAgentDto,
	UpdateBuildAgentDto,
	BuildAgentRegistrationDto,
	RegisterBuildAgentDto,
	BuildAgentCredentialsDto,
	AgentHeartbeatDto,
	AgentHeartbeatResponseDto,
	AgentClaimDto,
	AgentTaskLogsDto,
	AgentTaskResultDto,
	AgentTaskSourceDto,
	AgentOkDto,
	createAgentSchema,
	updateAgentSchema,
	registerAgentSchema,
	heartbeatSchema,
	taskLogsSchema,
	taskResultSchema,
	taskSourceSchema,
	agentIdSchema
} from './build-agents.dto.js';

@ApiTags('build-agents')
@Controller('platform/build-agents')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformBuildAgentsController {
	constructor(private readonly agents: BuildAgentsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformBuildAgentsList', summary: 'List external build servers' })
	@ApiOkResponse({ type: [BuildAgentDto] })
	list() {
		return this.agents.list();
	}

	@Post()
	@HttpCode(200)
	@ApiOperation({ operationId: 'platformBuildAgentsCreate', summary: 'Create a one-time build server registration' })
	@ApiBody({ type: CreateBuildAgentDto })
	@ApiOkResponse({ type: BuildAgentRegistrationDto })
	create(@Body(new ZodValidationPipe(createAgentSchema)) body: CreateBuildAgentDto) {
		return this.agents.create(body);
	}

	@Put(':id')
	@ApiOperation({ operationId: 'platformBuildAgentsUpdate', summary: 'Pause a server or configure its capacity' })
	@ApiBody({ type: UpdateBuildAgentDto })
	@ApiOkResponse({ type: AgentOkDto })
	update(@Param('id', new ZodValidationPipe(agentIdSchema)) id: string, @Body(new ZodValidationPipe(updateAgentSchema)) body: UpdateBuildAgentDto) {
		return this.agents.update(id, body);
	}

	@Post(':id/revoke')
	@HttpCode(200)
	@ApiOperation({ operationId: 'platformBuildAgentsRevoke', summary: 'Revoke a server and fail its active builds' })
	@ApiOkResponse({ type: AgentOkDto })
	revoke(@Param('id', new ZodValidationPipe(agentIdSchema)) id: string) {
		return this.agents.revoke(id);
	}

	@Delete(':id')
	@ApiOperation({ operationId: 'platformBuildAgentsDelete', summary: 'Remove a server with no active builds' })
	@ApiOkResponse({ type: AgentOkDto })
	remove(@Param('id', new ZodValidationPipe(agentIdSchema)) id: string) {
		return this.agents.remove(id);
	}
}

@ApiTags('build-agents')
@Controller('build-agent')
export class BuildAgentRegistrationController {
	constructor(private readonly agents: BuildAgentsService) {}
	@Post('register')
	@HttpCode(200)
	@UseGuards(AuthRateLimitGuard)
	@ApiOperation({ operationId: 'buildAgentRegister', summary: 'Exchange a one-time registration code' })
	@ApiBody({ type: RegisterBuildAgentDto })
	@ApiOkResponse({ type: BuildAgentCredentialsDto })
	register(@Body(new ZodValidationPipe(registerAgentSchema)) body: RegisterBuildAgentDto) {
		return this.agents.register(body.token);
	}
}

@ApiTags('build-agents')
@Controller('build-agent')
@UseGuards(BuildAgentGuard)
@ApiBearerAuth('buildAgentAuth')
export class BuildAgentController {
	constructor(private readonly agents: BuildAgentsService) {}
	@Post('heartbeat')
	@HttpCode(200)
	@ApiOperation({ operationId: 'buildAgentHeartbeat', summary: 'Report capacity and renew active build leases' })
	@ApiBody({ type: AgentHeartbeatDto })
	@ApiOkResponse({ type: AgentHeartbeatResponseDto })
	heartbeat(@Req() request: AgentRequest, @Body(new ZodValidationPipe(heartbeatSchema)) body: AgentHeartbeatDto) {
		return this.agents.heartbeat(request.buildAgentId, body);
	}

	@Post('claim')
	@HttpCode(200)
	@ApiOperation({ operationId: 'buildAgentClaim', summary: 'Claim the next assigned build' })
	@ApiOkResponse({ type: AgentClaimDto })
	claim(@Req() request: AgentRequest) {
		return this.agents.claim(request.buildAgentId);
	}

	@Post('tasks/:id/logs')
	@HttpCode(200)
	@ApiOperation({ operationId: 'buildAgentTaskLogs', summary: 'Append idempotent build logs' })
	@ApiBody({ type: AgentTaskLogsDto })
	@ApiOkResponse({ type: AgentOkDto })
	logs(
		@Req() request: AgentRequest,
		@Param('id', new ZodValidationPipe(agentIdSchema)) id: string,
		@Body(new ZodValidationPipe(taskLogsSchema)) body: AgentTaskLogsDto
	) {
		return this.agents.logs(request.buildAgentId, id, body);
	}

	@Post('tasks/:id/result')
	@HttpCode(200)
	@ApiOperation({ operationId: 'buildAgentTaskResult', summary: 'Complete the current build attempt' })
	@ApiBody({ type: AgentTaskResultDto })
	@ApiOkResponse({ type: AgentOkDto })
	result(
		@Req() request: AgentRequest,
		@Param('id', new ZodValidationPipe(agentIdSchema)) id: string,
		@Body(new ZodValidationPipe(taskResultSchema)) body: AgentTaskResultDto
	) {
		return this.agents.result(request.buildAgentId, id, body);
	}

	@Post('tasks/:id/source')
	@HttpCode(200)
	@ApiOperation({ operationId: 'buildAgentTaskSource', summary: 'Pin the checked-out source commit for retries' })
	@ApiBody({ type: AgentTaskSourceDto })
	@ApiOkResponse({ type: AgentOkDto })
	source(
		@Req() request: AgentRequest,
		@Param('id', new ZodValidationPipe(agentIdSchema)) id: string,
		@Body(new ZodValidationPipe(taskSourceSchema)) body: AgentTaskSourceDto
	) {
		return this.agents.source(request.buildAgentId, id, body);
	}
}
