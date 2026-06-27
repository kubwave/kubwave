import { afterEach, describe, expect, it } from 'bun:test';
import { buildOpenPrsRequest, detectForge, listOpenPullRequests, mapOpenPrs, parseRepoUrl } from '~/modules/worker/jobs/pr-preview/providers';

describe('parseRepoUrl', () => {
	it('parses https with .git', () => {
		expect(parseRepoUrl('https://github.com/owner/repo.git')).toEqual({ host: 'github.com', path: 'owner/repo' });
	});
	it('parses https without .git', () => {
		expect(parseRepoUrl('https://github.com/owner/repo')).toEqual({ host: 'github.com', path: 'owner/repo' });
	});
	it('parses scp/ssh form', () => {
		expect(parseRepoUrl('git@github.com:owner/repo.git')).toEqual({ host: 'github.com', path: 'owner/repo' });
	});
	it('parses ssh:// form with a port', () => {
		expect(parseRepoUrl('ssh://git@gitea.example:2222/owner/repo.git')).toEqual({ host: 'gitea.example', path: 'owner/repo' });
	});
	it('preserves GitLab subgroups', () => {
		expect(parseRepoUrl('https://gitlab.com/group/sub/repo.git')).toEqual({ host: 'gitlab.com', path: 'group/sub/repo' });
	});
	it('parses a self-hosted Gitea https url', () => {
		expect(parseRepoUrl('https://gitea.example/kintex/app.git')).toEqual({ host: 'gitea.example', path: 'kintex/app' });
	});
	it('returns null for non-urls', () => {
		expect(parseRepoUrl('not a url')).toBeNull();
	});
	it('returns null when the path has no slash', () => {
		expect(parseRepoUrl('https://host/no-slash')).toBeNull();
	});
});

describe('detectForge', () => {
	it('detects github.com', () => {
		expect(detectForge('github.com')).toBe('github');
	});
	it('detects gitlab.com', () => {
		expect(detectForge('gitlab.com')).toBe('gitlab');
	});
	it('treats a self-hosted host as gitea', () => {
		expect(detectForge('gitea.example')).toBe('gitea');
	});
	it('treats any other host as gitea', () => {
		expect(detectForge('git.example.org')).toBe('gitea');
	});
});

describe('mapOpenPrs', () => {
	it('maps github/gitea pulls', () => {
		const sha = 'a'.repeat(40);
		expect(mapOpenPrs('github', [{ number: 42, head: { sha } }])).toEqual([{ prNumber: 42, prRef: 'refs/pull/42/head', headSha: sha }]);
		expect(mapOpenPrs('gitea', [{ number: 42, head: { sha } }])).toEqual([{ prNumber: 42, prRef: 'refs/pull/42/head', headSha: sha }]);
	});
	it('maps gitlab merge requests via iid', () => {
		const sha = 'b'.repeat(40);
		expect(mapOpenPrs('gitlab', [{ iid: 7, sha }])).toEqual([{ prNumber: 7, prRef: 'refs/merge-requests/7/head', headSha: sha }]);
	});
	it('skips malformed github/gitea items (missing sha or number)', () => {
		expect(mapOpenPrs('github', [{ number: 1 }, { head: { sha: 'c'.repeat(40) } }, { number: 'x', head: { sha: 'c'.repeat(40) } }])).toEqual([]);
	});
	it('skips malformed gitlab items (missing sha or iid)', () => {
		expect(mapOpenPrs('gitlab', [{ iid: 1 }, { sha: 'd'.repeat(40) }])).toEqual([]);
	});
});

describe('buildOpenPrsRequest', () => {
	it('builds a github request with auth + api-version headers', () => {
		const { url, headers } = buildOpenPrsRequest('github', { host: 'github.com', path: 'o/r' }, { github: 'tok' }, 1);
		expect(url).toBe('https://api.github.com/repos/o/r/pulls?state=open&per_page=100&page=1');
		expect(headers.Authorization).toBe('Bearer tok');
		expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
		expect(headers.Accept).toBe('application/vnd.github+json');
	});
	it('builds a gitlab request with url-encoded path + PRIVATE-TOKEN', () => {
		const { url, headers } = buildOpenPrsRequest('gitlab', { host: 'gitlab.com', path: 'group/sub/repo' }, { gitlab: 'tok' }, 1);
		expect(url).toBe('https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo/merge_requests?state=opened&per_page=100&page=1');
		expect(headers['PRIVATE-TOKEN']).toBe('tok');
	});
	it('builds a gitea request with token auth', () => {
		const { url, headers } = buildOpenPrsRequest('gitea', { host: 'gitea.example', path: 'o/r' }, { gitea: 'tok' }, 1);
		expect(url).toBe('https://gitea.example/api/v1/repos/o/r/pulls?state=open&limit=50&page=1');
		expect(headers.Authorization).toBe('token tok');
	});
	it('omits the Authorization header for gitea when no token is set', () => {
		const { headers } = buildOpenPrsRequest('gitea', { host: 'gitea.example', path: 'o/r' }, {}, 1);
		expect(headers.Authorization).toBeUndefined();
	});
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
function stubFetch(responses: Array<{ ok: boolean; status?: number; json?: unknown; text?: string }>): { calls: number } {
	const state = { calls: 0 };
	globalThis.fetch = (async () => {
		const r = responses[Math.min(state.calls++, responses.length - 1)]!;
		return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.json, text: async () => r.text ?? '' } as unknown as Response;
	}) as unknown as typeof fetch;
	return state;
}

describe('listOpenPullRequests', () => {
	it('returns the mapped PRs for a single short page', async () => {
		const sha = 'a'.repeat(40);
		const state = stubFetch([{ ok: true, json: [{ number: 1, head: { sha } }] }]);
		const prs = await listOpenPullRequests('https://gitea.example/o/r.git', {});
		expect(prs).toEqual([{ prNumber: 1, prRef: 'refs/pull/1/head', headSha: sha }]);
		expect(state.calls).toBe(1);
	});

	it('throws on a non-ok response (never silently returns empty)', async () => {
		stubFetch([{ ok: false, status: 404, text: 'Not Found' }]);
		await expect(listOpenPullRequests('https://gitea.example/o/r.git', {})).rejects.toThrow();
	});

	it('throws on an unparseable repo url', async () => {
		await expect(listOpenPullRequests('not a url', {})).rejects.toThrow('Unparseable repo URL');
	});

	it('paginates until a short page and concatenates results (github full page = 100)', async () => {
		const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, head: { sha: 'a'.repeat(40) } }));
		const short = [{ number: 101, head: { sha: 'b'.repeat(40) } }];
		const state = stubFetch([
			{ ok: true, json: full },
			{ ok: true, json: short }
		]);
		const prs = await listOpenPullRequests('https://github.com/o/r.git', {});
		expect(state.calls).toBe(2);
		expect(prs).toHaveLength(101);
		expect(prs[0]).toEqual({ prNumber: 1, prRef: 'refs/pull/1/head', headSha: 'a'.repeat(40) });
		expect(prs[100]).toEqual({ prNumber: 101, prRef: 'refs/pull/101/head', headSha: 'b'.repeat(40) });
	});

	it('throws when the API returns a non-array body', async () => {
		stubFetch([{ ok: true, json: { message: 'nope' } }]);
		await expect(listOpenPullRequests('https://gitea.example/o/r.git', {})).rejects.toThrow('non-array');
	});

	it('lists GitLab merge requests end-to-end via the gitlab path', async () => {
		const sha = 'c'.repeat(40);
		const state = stubFetch([{ ok: true, json: [{ iid: 5, sha }] }]);
		const prs = await listOpenPullRequests('https://gitlab.com/group/sub/repo.git', { gitlab: 'tok' });
		expect(prs).toEqual([{ prNumber: 5, prRef: 'refs/merge-requests/5/head', headSha: sha }]);
		expect(state.calls).toBe(1); // 1 item < per_page 100 → single page
	});

	it('dedupes by PR number across pages and returns results sorted ascending', async () => {
		const sha = 'a'.repeat(40);
		// 100 items (full page) repeats #1 from the next short page → must dedupe + sort.
		const full = Array.from({ length: 100 }, (_, i) => ({ number: 100 - i, head: { sha } }));
		const short = [{ number: 1, head: { sha } }]; // duplicate of an item on page 1
		stubFetch([
			{ ok: true, json: full },
			{ ok: true, json: short }
		]);
		const prs = await listOpenPullRequests('https://github.com/o/r.git', {});
		expect(prs).toHaveLength(100); // 100 unique (the #1 duplicate dropped)
		expect(prs[0]!.prNumber).toBe(1);
		expect(prs[99]!.prNumber).toBe(100);
	});

	it('stops at maxPages even when every page is full (bounded pagination)', async () => {
		const sha = 'a'.repeat(40);
		const full = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, head: { sha } })); // gitea page size = 50
		const state = stubFetch([{ ok: true, json: full }]);
		const prs = await listOpenPullRequests('https://gitea.example/o/r.git', {}, { maxPages: 2 });
		expect(state.calls).toBe(2); // never exceeds maxPages despite full pages
		expect(prs).toHaveLength(50); // 50 unique numbers (pages identical → deduped)
	});
});
