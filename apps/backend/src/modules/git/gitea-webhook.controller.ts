import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { GiteaWebhookService } from './gitea-webhook.service.js';

function header(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

@ApiTags('git')
@Controller('git/gitea')
export class GiteaWebhookController {
	constructor(private readonly webhooks: GiteaWebhookService) {}

	@Post('webhook')
	@HttpCode(202)
	@ApiExcludeEndpoint()
	receive(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ status: string }> {
		return this.webhooks.handle(
			req.rawBody,
			header(req.headers['x-gitea-signature']),
			header(req.headers['x-hub-signature-256']),
			header(req.headers['x-gitea-event']) ?? header(req.headers['x-github-event']),
			req.body
		);
	}
}
