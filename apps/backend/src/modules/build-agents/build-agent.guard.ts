import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { BuildAgentsService } from './build-agents.service.js';
import { ApiError } from '../../shared/errors/api-error.js';

export interface AgentRequest extends FastifyRequest {
	buildAgentId: string;
}

@Injectable()
export class BuildAgentGuard implements CanActivate {
	constructor(private readonly agents: BuildAgentsService) {}
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AgentRequest>();
		const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
		if (!token) throw new ApiError(401, 'invalid_build_agent_token');
		request.buildAgentId = await this.agents.authenticate(token);
		return true;
	}
}
