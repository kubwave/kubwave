import { eq } from 'drizzle-orm';
import {
	db,
	services,
	type GithubRepoServiceConfig,
	type PrivateRepoServiceConfig,
	type PublicRepoServiceConfig,
	type ServiceConfig
} from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { listChangedPaths } from './changed-paths.js';
import { resolveRemoteHead } from './ls-remote.js';
import { computeBackoffAt, shouldDeploy } from './schedule.js';
import { enqueueAutoDeployment } from './enqueue.js';
import { effectiveWatchPaths, pathsMatch } from './watch-paths.js';
import type { DueService } from './claim.js';

function repoRef(config: ServiceConfig): { repoUrl: string; branch: string; sshKeyId?: string; installationId?: string } {
	const repo = config as PublicRepoServiceConfig | PrivateRepoServiceConfig | GithubRepoServiceConfig;
	return {
		repoUrl: repo.repoUrl,
		branch: repo.branch,
		sshKeyId: (repo as PrivateRepoServiceConfig).sshKeyId,
		installationId: (repo as GithubRepoServiceConfig).installationId
	};
}

async function shouldEnqueueForPaths(service: DueService, head: string): Promise<boolean> {
	const prefixes = effectiveWatchPaths(service.config);
	if (prefixes.length === 0 || !service.lastPolledCommit) return true;

	const { repoUrl, sshKeyId, installationId } = repoRef(service.config);
	try {
		const files = await listChangedPaths({
			repoUrl,
			oldSha: service.lastPolledCommit,
			newSha: head,
			sshKeyId,
			installationId,
			timeoutMs: env.gitDiffTimeoutMs
		});
		const match = pathsMatch(files, prefixes);
		if (!match) {
			console.info(`[git-poll] service ${service.id}: auto-deploy skipped (no changes under watch paths)`);
		}
		return match;
	} catch (err) {
		// Fail-open: a flaky diff must not stall auto-deploy.
		console.warn(`[git-poll] service ${service.id}: path filter failed, deploying anyway:`, errorMessage(err));
		return true;
	}
}

// Poll one claimed service: new HEAD may enqueue (path-filtered); always record the SHA so the same commit never re-triggers.
export async function pollService(service: DueService, now: Date): Promise<void> {
	const { repoUrl, branch, sshKeyId, installationId } = repoRef(service.config);
	try {
		const head = await resolveRemoteHead({ repoUrl, branch, sshKeyId, installationId, timeoutMs: env.gitLsRemoteTimeoutMs });
		if (head && shouldDeploy(head, service.lastPolledCommit) && (await shouldEnqueueForPaths(service, head))) {
			await enqueueAutoDeployment(service, head);
		}
		// Record the observed HEAD (even if unchanged / path-skipped) and clear any prior error.
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
