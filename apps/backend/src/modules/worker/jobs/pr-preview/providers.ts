// Lists OPEN PRs via the forge HTTP API (git refs can't detect close/merge). Host routing: github->GitHub, gitlab->GitLab, else Gitea; a wrong guess just 404s.

export interface OpenPr {
	prNumber: number;
	// refs/pull/<n>/head (GitHub/Gitea) | refs/merge-requests/<iid>/head (GitLab); git-poll tracks it.
	prRef: string;
	headSha: string;
}

export type Forge = 'github' | 'gitlab' | 'gitea';

export interface ForgeTokens {
	github?: string;
	gitlab?: string;
	gitea?: string;
}

export interface RepoRef {
	host: string;
	// owner/repo, or group/sub/repo for GitLab subgroups. No leading slash, no trailing .git.
	path: string;
}

// Parse an https or scp/ssh git URL into { host, path }. Returns null if unparseable.
export function parseRepoUrl(repoUrl: string): RepoRef | null {
	const url = repoUrl.trim();
	let host = '';
	let rawPath = '';
	if (url.includes('://')) {
		try {
			const u = new URL(url);
			host = u.hostname;
			rawPath = u.pathname;
		} catch {
			return null;
		}
	} else {
		// scp form: [user@]host:owner/repo(.git)
		const m = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(url);
		if (!m) return null;
		host = m[1]!;
		rawPath = m[2]!;
	}
	const path = rawPath
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\.git$/, '');
	if (!host || !path.includes('/')) return null;
	return { host, path };
}

export function detectForge(host: string): Forge {
	if (host === 'github.com') return 'github';
	if (host === 'gitlab.com') return 'gitlab';
	return 'gitea';
}

// Map one forge's raw JSON array (a page of open PRs/MRs) to OpenPr[]. Skips malformed items.
export function mapOpenPrs(forge: Forge, items: unknown[]): OpenPr[] {
	const out: OpenPr[] = [];
	for (const it of items) {
		const o = it as Record<string, unknown>;
		if (forge === 'gitlab') {
			const iid = Number(o.iid);
			const sha = o.sha;
			if (Number.isInteger(iid) && typeof sha === 'string') {
				out.push({ prNumber: iid, prRef: `refs/merge-requests/${iid}/head`, headSha: sha });
			}
		} else {
			const number = Number(o.number);
			const head = o.head as { sha?: unknown } | undefined;
			const sha = head?.sha;
			if (Number.isInteger(number) && typeof sha === 'string') {
				out.push({ prNumber: number, prRef: `refs/pull/${number}/head`, headSha: sha });
			}
		}
	}
	return out;
}

// Per-page page size by forge (GitHub/GitLab use per_page; Gitea uses limit).
function pageSize(forge: Forge): number {
	return forge === 'gitea' ? 50 : 100;
}

export function buildOpenPrsRequest(forge: Forge, ref: RepoRef, tokens: ForgeTokens, page: number): { url: string; headers: Record<string, string> } {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (forge === 'github') {
		if (tokens.github) headers.Authorization = `Bearer ${tokens.github}`;
		headers.Accept = 'application/vnd.github+json';
		headers['X-GitHub-Api-Version'] = '2022-11-28';
		return { url: `https://api.github.com/repos/${ref.path}/pulls?state=open&per_page=100&page=${page}`, headers };
	}
	if (forge === 'gitlab') {
		if (tokens.gitlab) headers['PRIVATE-TOKEN'] = tokens.gitlab;
		return {
			url: `https://${ref.host}/api/v4/projects/${encodeURIComponent(ref.path)}/merge_requests?state=opened&per_page=100&page=${page}`,
			headers
		};
	}
	if (tokens.gitea) headers.Authorization = `token ${tokens.gitea}`;
	return { url: `https://${ref.host}/api/v1/repos/${ref.path}/pulls?state=open&limit=50&page=${page}`, headers };
}

// List a repo's OPEN PRs via its forge API, paginating to a short page; throws on parse/network/non-2xx so an error is never read as "no open PRs".
export async function listOpenPullRequests(
	repoUrl: string,
	tokens: ForgeTokens,
	opts?: { timeoutMs?: number; maxPages?: number }
): Promise<OpenPr[]> {
	const ref = parseRepoUrl(repoUrl);
	if (!ref) throw new Error(`Unparseable repo URL: ${repoUrl}`);
	const forge = detectForge(ref.host);
	const timeoutMs = opts?.timeoutMs ?? 20_000;
	const maxPages = opts?.maxPages ?? 10;
	const size = pageSize(forge);
	const all: OpenPr[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const { url, headers } = buildOpenPrsRequest(forge, ref, tokens, page);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res: Response;
		try {
			res = await fetch(url, { headers, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`${forge} API ${res.status} for ${ref.path}${body ? `: ${body.slice(0, 200)}` : ''}`);
		}
		const json: unknown = await res.json();
		if (!Array.isArray(json)) throw new Error(`${forge} API returned a non-array body for ${ref.path}`);
		all.push(...mapOpenPrs(forge, json));
		if (json.length < size) break; // short page -> last page
	}
	const seen = new Set<number>();
	return all.filter(p => (seen.has(p.prNumber) ? false : (seen.add(p.prNumber), true))).sort((a, b) => a.prNumber - b.prNumber);
}
