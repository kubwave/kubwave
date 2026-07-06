import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { GithubWebhookService } from './github-webhook.service.js';

function header(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

@ApiTags('git')
@Controller('git/github')
export class GithubWebhookController {
	constructor(private readonly webhooks: GithubWebhookService) {}

	@Post('webhook')
	@HttpCode(202)
	@ApiExcludeEndpoint()
	receive(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ status: string }> {
		return this.webhooks.handle(req.rawBody, header(req.headers['x-hub-signature-256']), header(req.headers['x-github-event']), req.body);
	}
}
