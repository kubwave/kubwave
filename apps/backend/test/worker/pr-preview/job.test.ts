import { afterEach, describe, expect, mock, test } from 'bun:test';

// pollEnvironment: list open PRs per repo → diff vs existing previews → teardown gone / clone
// new (capped) → write pr_last_poll_error. CRITICAL invariant: a failed list NEVER tears down.

let listResult: { prs: Array<{ prNumber: number; prRef: string; headSha: string }> } | { error: string } = { prs: [] };
let cap = 5;
let selectResults: unknown[][] = [];
let selectIdx = 0;
let updatedSet: Record<string, unknown> | null = null;
const teardownCalls: string[] = [];
const cloneCalls: number[] = [];

mock.module('~/shared/config/worker-env', () => ({
	env: { gitLsRemoteTimeoutMs: 20_000, gitPollErrorBackoffSeconds: 300, prDiscoveryEnvIntervalSeconds: 60, prDiscoveryBatch: 10 }
}));
mock.module('~/modules/worker/jobs/pr-preview/providers', () => ({
	listOpenPullRequests: async () => {
		if ('error' in listResult) throw new Error(listResult.error);
		return listResult.prs;
	}
}));
mock.module('~/modules/worker/jobs/pr-preview/cap', () => ({ getMaxPreviewsPerProject: async () => cap }));
mock.module('~/modules/worker/jobs/pr-preview/clone', () => ({
	clonePreview: async (_base: unknown, pr: { prNumber: number }) => {
		cloneCalls.push(pr.prNumber);
	}
}));
mock.module('~/modules/worker/jobs/pr-preview/teardown', () => ({
	teardownPreview: async (id: string) => {
		teardownCalls.push(id);
	}
}));
mock.module('@kubwave/db', () => ({
	environments: {},
	services: {},
	db: {
		select: () => ({ from: () => ({ where: async () => selectResults[selectIdx++] ?? [] }) }),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updatedSet = values;
				return { where: async () => undefined };
			}
		})
	}
}));

const { pollEnvironment } = await import('~/modules/worker/jobs/pr-preview/job');

const now = new Date('2026-06-15T12:00:00.000Z');
const baseEnv = { id: 'env-base', projectId: 'proj-1' } as never;
const repoService = { type: 'public-repo', config: { repoUrl: 'https://github.com/o/r.git' } };

afterEach(() => {
	selectResults = [];
	selectIdx = 0;
	updatedSet = null;
	teardownCalls.length = 0;
	cloneCalls.length = 0;
	cap = 5;
});

describe('pollEnvironment', () => {
	test('SAFETY: a failed open-PR lookup never tears down and backs the env off', async () => {
		listResult = { error: 'forge API 500 for o/r' };
		selectResults = [[repoService]]; // repoTargets sees one repo-backed service
		await pollEnvironment(baseEnv, now);
		expect(teardownCalls).toEqual([]); // <-- the invariant
		expect(cloneCalls).toEqual([]);
		expect(updatedSet?.prLastPollError).toBe('forge API 500 for o/r');
		const nextPoll = updatedSet?.prNextPollAt;
		expect(nextPoll).toBeInstanceOf(Date);
		expect((nextPoll as Date).getTime()).toBeGreaterThanOrEqual(now.getTime() + 240_000);
	});

	test('tears down a preview whose PR is no longer open, and clears the error', async () => {
		listResult = { prs: [] }; // no open PRs
		selectResults = [
			[repoService], // repoTargets
			[{ id: 'env-9', prNumber: 9 }] // existingPreviews → stale preview to remove
		];
		await pollEnvironment(baseEnv, now);
		expect(teardownCalls).toEqual(['env-9']);
		expect(cloneCalls).toEqual([]);
		expect(updatedSet).toEqual({ prLastPollError: null });
	});

	test('creates a preview for a new open PR up to the cap', async () => {
		cap = 1;
		listResult = { prs: [{ prNumber: 7, prRef: 'refs/pull/7/head', headSha: 'a'.repeat(40) }] };
		selectResults = [
			[repoService], // repoTargets
			[], // existingPreviews → none
			[{ value: 0 }] // previewCountForProject → 0 used
		];
		await pollEnvironment(baseEnv, now);
		expect(cloneCalls).toEqual([7]);
		expect(teardownCalls).toEqual([]);
	});

	test('private-repo services are excluded from PR discovery (no forge auth provisioned)', async () => {
		listResult = { prs: [{ prNumber: 7, prRef: 'refs/pull/7/head', headSha: 'a'.repeat(40) }] };
		// repoTargets sees only a private-repo service → no targets → nothing discovered.
		selectResults = [[{ type: 'private-repo', config: { repoUrl: 'git@x:o/r.git', sshKeyId: 'k' } }]];
		await pollEnvironment(baseEnv, now);
		expect(cloneCalls).toEqual([]);
		expect(teardownCalls).toEqual([]);
	});
});
