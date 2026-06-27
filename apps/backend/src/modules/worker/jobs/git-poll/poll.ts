import { eq } from 'drizzle-orm';
import { db, services, type PrivateRepoServiceConfig, type PublicRepoServiceConfig, type ServiceConfig } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { resolveRemoteHead } from './ls-remote.js';
import { computeBackoffAt, shouldDeploy } from './schedule.js';
import { enqueueAutoDeployment } from './enqueue.js';
import type { DueService } from './claim.js';

function repoRef(config: ServiceConfig): { repoUrl: string; branch: string; sshKeyId?: string } {
	const repo = config as PublicRepoServiceConfig | PrivateRepoServiceConfig;
	return { repoUrl: repo.repoUrl, branch: repo.branch, sshKeyId: (repo as PrivateRepoServiceConfig).sshKeyId };
}

// Poll one claimed service. On a new branch HEAD: enqueue (pinning the SHA) and record it,
// so the same SHA is never re-triggered. On failure: store the message and back off.
export async function pollService(service: DueService, now: Date): Promise<void> {
	const { repoUrl, branch, sshKeyId } = repoRef(service.config);
	try {
		const head = await resolveRemoteHead({ repoUrl, branch, sshKeyId, timeoutMs: env.gitLsRemoteTimeoutMs });
		if (shouldDeploy(head, service.lastPolledCommit)) {
			await enqueueAutoDeployment(service, head!);
		}
		// Record the observed HEAD (even if unchanged) and clear any prior error.
		await db
			.update(services)
			.set({ lastPolledCommit: head ?? service.lastPolledCommit, lastPollError: null })
			.where(eq(services.id, service.id));
	} catch (err) {
		const message = errorMessage(err);
		console.warn(`[git-poll] service ${service.id} poll failed:`, message);
		await db
			.update(services)
			.set({ lastPollError: message, nextPollAt: computeBackoffAt(now, env.gitPollServiceIntervalSeconds, env.gitPollErrorBackoffSeconds) })
			.where(eq(services.id, service.id));
	}
}
