import { ApiError } from '../../shared/errors/api-error.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_OAUTH = 'https://github.com';

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

// Exchange an OAuth-on-install code for the installer's user-to-server token, so we can confirm they actually control the installation.
export async function exchangeOAuthCode(clientId: string, clientSecret: string, code: string): Promise<string> {
	const res = await fetch(`${GITHUB_OAUTH}/login/oauth/access_token`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new ApiError(502, 'github_oauth_error', body ? body.slice(0, 200) : undefined);
	}
	const json = (await res.json()) as { access_token?: unknown; error?: unknown };
	if (typeof json.access_token !== 'string' || !json.access_token) {
		throw new ApiError(502, 'github_oauth_error', typeof json.error === 'string' ? json.error : undefined);
	}
	return json.access_token;
}

// Installation ids the user can administer — the ownership proof: only someone who controls the install sees it here.
export async function listUserInstallationIds(userToken: string, opts?: { maxPages?: number }): Promise<Set<string>> {
	const maxPages = opts?.maxPages ?? 10;
	const ids = new Set<string>();
	for (let page = 1; page <= maxPages; page++) {
		const res = await fetch(`${GITHUB_API}/user/installations?per_page=100&page=${page}`, { headers: ghHeaders(`token ${userToken}`) });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new ApiError(502, 'github_api_error', body ? body.slice(0, 200) : undefined);
		}
		const json = (await res.json()) as { installations?: unknown };
		const arr = Array.isArray(json.installations) ? json.installations : [];
		for (const it of arr) {
			const id = (it as { id?: unknown }).id;
			if (typeof id === 'number' || typeof id === 'string') ids.add(String(id));
		}
		if (arr.length < 100) break;
	}
	return ids;
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
