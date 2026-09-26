import { and, eq, sql } from 'drizzle-orm';
import { db, environments, services, type Environment } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { computeBackoffAt } from '../git-poll/schedule.js';
import { claimDueEnvironments } from './claim.js';
import { clonePreview } from './clone.js';
import { teardownPreview } from './teardown.js';
import { diffPreviews } from './diff.js';
import { getInstallationAccessToken } from '../../../git/clone-token.js';
import { listOpenPullRequests, type ForgeTokens, type OpenPr } from './providers.js';
import { getMaxPreviewsPerProject } from './cap.js';

// One discovery sweep tick: claim due envs and process them concurrently.
export async function runPrDiscovery(): Promise<void> {
	const now = new Date();
	const due = await claimDueEnvironments(now, env.prDiscoveryBatch);
	if (due.length === 0) return;
	await Promise.all(due.map(e => pollEnvironment(e, now)));
}

// Distinct repos to discover PRs for (a monorepo is one URL): public repos need no auth; github-repo/gitea-repo list via their installation token.
// private-repo (SSH key only) is excluded — no forge-API credential — but still gets cloned INTO previews triggered by another repo's PR.
async function repoTargets(environmentId: string): Promise<Map<string, string | null>> {
	const rows = await db.select({ type: services.type, config: services.config }).from(services).where(eq(services.environmentId, environmentId));
	const targets = new Map<string, string | null>();
	for (const r of rows) {
		const config = r.config as { repoUrl: string; installationId?: string };
		if (r.type === 'public-repo') {
			if (!targets.has(config.repoUrl)) targets.set(config.repoUrl, null);
		} else if (r.type === 'github-repo' || r.type === 'gitea-repo') {
			if (!targets.get(config.repoUrl)) targets.set(config.repoUrl, config.installationId ?? null);
		}
	}
	return targets;
}

async function forgeTokens(installationId: string | null): Promise<ForgeTokens> {
	if (!installationId) return {};
	const { provider, token } = await getInstallationAccessToken(installationId);
	return { [provider]: token };
}

async function existingPreviews(baseEnvironmentId: string, repoUrl: string): Promise<{ id: string; prNumber: number }[]> {
	const rows = await db
		.select({ id: environments.id, prNumber: environments.prNumber })
		.from(environments)
		.where(and(eq(environments.baseEnvironmentId, baseEnvironmentId), eq(environments.prRepoUrl, repoUrl)));
	return rows.filter((r): r is { id: string; prNumber: number } => r.prNumber !== null);
}

async function previewCountForProject(projectId: string): Promise<number> {
	const [row] = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(environments)
		.where(and(eq(environments.projectId, projectId), eq(environments.kind, 'preview')));
	return row?.value ?? 0;
}

// Process one base env: per repo list OPEN PRs, diff against existing previews, create new (up to cap), tear down gone ones.
// A repo failure is recorded and SKIPPED, never read as "no open PRs" — teardown happens only after a successful list (else it'd kill live previews).
export async function pollEnvironment(baseEnv: Environment, now: Date): Promise<void> {
	const targets = await repoTargets(baseEnv.id);
	const cap = await getMaxPreviewsPerProject();
	let pollError: string | null = null;

	for (const [repoUrl, installationId] of targets) {
		let open: OpenPr[];
		try {
			open = await listOpenPullRequests(repoUrl, await forgeTokens(installationId), { timeoutMs: env.gitLsRemoteTimeoutMs });
		} catch (err) {
			pollError = errorMessage(err);
			console.warn(`[pr-discovery] env ${baseEnv.id} repo ${repoUrl} open-PR lookup failed:`, pollError);
			continue; // do NOT teardown on error
		}

		const existing = await existingPreviews(baseEnv.id, repoUrl);
		const { toCreate, toTeardown } = diffPreviews(open, existing);

		for (const dead of toTeardown) {
			await teardownPreview(dead.id).catch(e => console.warn(`[pr-discovery] teardown ${dead.id} failed:`, errorMessage(e)));
		}

		// Soft cap: count read before each create, so concurrent replicas can briefly overshoot; a hard cap would need the count inside the clone transaction.
		for (const pr of toCreate) {
			const used = await previewCountForProject(baseEnv.projectId);
			if (used >= cap) {
				console.log(`[pr-discovery] project ${baseEnv.projectId} at preview cap (${cap}); deferring PR #${pr.prNumber}`);
				break; // a later sweep creates it once a slot frees
			}
			try {
				await clonePreview(baseEnv, pr, repoUrl);
			} catch (e) {
				console.warn(`[pr-discovery] clone PR #${pr.prNumber} failed:`, errorMessage(e));
			}
		}
	}

	// If ANY repo failed, back the whole env off and surface the error — usually shared (auth/network). Work this tick landed; only the next poll is delayed.
	if (pollError) {
		await db
			.update(environments)
			.set({ prLastPollError: pollError, prNextPollAt: computeBackoffAt(now, env.prDiscoveryEnvIntervalSeconds, env.gitPollErrorBackoffSeconds) })
			.where(eq(environments.id, baseEnv.id));
	} else {
		await db.update(environments).set({ prLastPollError: null }).where(eq(environments.id, baseEnv.id));
	}
}
