import { Injectable } from '@nestjs/common';
import { verifyGiteaWebhookSignature, verifyWebhookSignature } from '@kubwave/crypto';
import { ApiError } from '../../shared/errors/api-error.js';
import { GiteaConnectionService } from './gitea-connection.service.js';
import { GiteaInstallationsService } from './gitea-installations.service.js';
import { parseGiteaWebhookEvent } from './gitea-webhook.js';

@Injectable()
export class GiteaWebhookService {
	constructor(
		private readonly connections: GiteaConnectionService,
		private readonly installations: GiteaInstallationsService
	) {}

	async handle(
		rawBody: Buffer | undefined,
		giteaSignature: string | undefined,
		hubSignature: string | undefined,
		event: string | undefined,
		payload: unknown
	): Promise<{ status: string }> {
		if (!event) throw new ApiError(400, 'missing_event');
		const secret = await this.connections.getWebhookSecret();
		if (secret === null) throw new ApiError(404, 'no_gitea_connection');
		const ok =
			!!rawBody &&
			!!secret &&
			(verifyGiteaWebhookSignature(rawBody, giteaSignature, secret) || verifyWebhookSignature(rawBody, hubSignature, secret));
		if (!ok) throw new ApiError(401, 'invalid_signature');

		const action = parseGiteaWebhookEvent(event, payload);
		if (action.kind === 'push') await this.installations.applyPush(action.repoFullName, action.branch);
		return { status: action.kind };
	}
}
