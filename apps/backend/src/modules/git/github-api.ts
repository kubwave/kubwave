import { ApiError } from '../../shared/errors/api-error.js';

const GITHUB_API = 'https://api.github.com';

function ghHeaders(auth: string): Record<string, string> {
	return { Authorization: auth, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

export interface RepoInfo {
	fullName: string;
	defaultBranch: string;
	isPrivate: boolean;
}

export function mapRepoPage(items: unknown): RepoInfo[] {
	if (!Array.isArray(items)) return [];
	const out: RepoInfo[] = [];
	for (const it of items) {
		const o = it as { full_name?: unknown; default_branch?: unknown; private?: unknown };
		if (typeof o.full_name !== 'string' || !o.full_name) continue;
		out.push({
			fullName: o.full_name,
			defaultBranch: typeof o.default_branch === 'string' && o.default_branch ? o.default_branch : 'main',
			isPrivate: o.private !== false
		});
	}
	return out;
}

export async function getAppInstallation(appJwt: string, githubInstallationId: string): Promise<{ accountLogin: string; accountType: string }> {
	const res = await fetch(`${GITHUB_API}/app/installations/${encodeURIComponent(githubInstallationId)}`, { headers: ghHeaders(`Bearer ${appJwt}`) });
	if (res.status === 404) throw new ApiError(404, 'github_installation_not_found');
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new ApiError(502, 'github_api_error', body ? body.slice(0, 200) : undefined);
	}
	const json = (await res.json()) as { account?: { login?: unknown; type?: unknown } };
	const account = json.account ?? {};
	return {
		accountLogin: typeof account.login === 'string' ? account.login : '',
		accountType: typeof account.type === 'string' ? account.type : ''
	};
}

export async function listInstallationRepos(token: string, opts?: { maxPages?: number }): Promise<RepoInfo[]> {
	const maxPages = opts?.maxPages ?? 10;
	const out: RepoInfo[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100&page=${page}`, { headers: ghHeaders(`token ${token}`) });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new ApiError(502, 'github_api_error', body ? body.slice(0, 200) : undefined);
		}
		const json = (await res.json()) as { repositories?: unknown };
		const mapped = mapRepoPage(json.repositories);
		out.push(...mapped);
		if (mapped.length < 100) break;
	}
	return out;
}
