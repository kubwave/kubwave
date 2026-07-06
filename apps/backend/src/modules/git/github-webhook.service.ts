import { Injectable } from '@nestjs/common';
import { verifyWebhookSignature } from '@kubwave/crypto';
import { ApiError } from '../../shared/errors/api-error.js';
import { GitConnectionService } from './git-connection.service.js';
import { GitInstallationsService } from './git-installations.service.js';
import { parseWebhookEvent } from './github-webhook.js';

@Injectable()
export class GithubWebhookService {
	constructor(
		private readonly connections: GitConnectionService,
		private readonly installations: GitInstallationsService
	) {}

	async handle(rawBody: Buffer | undefined, signature: string | undefined, event: string | undefined, payload: unknown): Promise<{ status: string }> {
		if (!event) throw new ApiError(400, 'missing_event');
		const secret = await this.connections.getWebhookSecret();
		// null = no App connected (404); '' = App created without a hook, which can't verify a delivery, so let it fall through to a 401.
		if (secret === null) throw new ApiError(404, 'no_github_connection');
		if (!rawBody || !secret || !verifyWebhookSignature(rawBody, signature, secret)) throw new ApiError(401, 'invalid_signature');

		const action = parseWebhookEvent(event, payload);
		await this.installations.applyWebhookAction(action);
		return { status: action.kind };
	}
}
