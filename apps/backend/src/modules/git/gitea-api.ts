import { ApiError } from '../../shared/errors/api-error.js';
import type { RepoInfo } from './github-api.js';

const CALLBACK_PATH = '/api/git/gitea/callback';
const WEBHOOK_PATH = '/api/git/gitea/webhook';
const OAUTH_SCOPES = 'read:repository write:repository read:user read:organization';

export { type RepoInfo };

function appBase(appBaseUrl: string): string {
	return appBaseUrl.replace(/\/+$/, '');
}

export function giteaCallbackUrl(appBaseUrl: string): string {
	return `${appBase(appBaseUrl)}${CALLBACK_PATH}`;
}

export function giteaWebhookUrl(appBaseUrl: string): string {
	return `${appBase(appBaseUrl)}${WEBHOOK_PATH}`;
}

export function giteaCloneUrl(instanceUrl: string, repoFullName: string): string {
	return `${instanceUrl.replace(/\/+$/, '')}/${repoFullName}.git`;
}

export function normalizeInstanceUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		throw new ApiError(400, 'invalid_gitea_url');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ApiError(400, 'invalid_gitea_url');
	if (!parsed.hostname) throw new ApiError(400, 'invalid_gitea_url');
	if (parsed.username || parsed.password) throw new ApiError(400, 'invalid_gitea_url');
	const path = parsed.pathname.replace(/\/+$/, '');
	return `${parsed.origin}${path === '/' ? '' : path}`;
}

export function buildAuthorizeUrl(instanceUrl: string, clientId: string, redirectUri: string, state: string): string {
	const url = new URL(`${instanceUrl}/login/oauth/authorize`);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('state', state);
	url.searchParams.set('scope', OAUTH_SCOPES);
	return url.toString();
}

export function mapGiteaRepoPage(items: unknown): RepoInfo[] {
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

interface TokenResponse {
	accessToken: string;
	refreshToken: string | null;
	expiresIn: number | null;
}

function parseTokenResponse(json: unknown, errorCode: string): TokenResponse {
	const o = (json ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown };
	if (typeof o.access_token !== 'string' || !o.access_token) {
		throw new ApiError(502, errorCode, typeof o.error === 'string' ? o.error : undefined);
	}
	return {
		accessToken: o.access_token,
		refreshToken: typeof o.refresh_token === 'string' && o.refresh_token ? o.refresh_token : null,
		expiresIn: typeof o.expires_in === 'number' && Number.isFinite(o.expires_in) ? o.expires_in : null
	};
}

async function postOAuth(instanceUrl: string, body: Record<string, string>, errorCode: string): Promise<TokenResponse> {
	const res = await fetch(`${instanceUrl}/login/oauth/access_token`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new ApiError(502, errorCode, text ? text.slice(0, 200) : undefined);
	}
	return parseTokenResponse(await res.json(), errorCode);
}

export function exchangeOAuthCode(
	instanceUrl: string,
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string
): Promise<TokenResponse> {
	return postOAuth(
		instanceUrl,
		{ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri },
		'gitea_oauth_error'
	);
}

export function refreshAccessToken(instanceUrl: string, clientId: string, clientSecret: string, refreshToken: string): Promise<TokenResponse> {
	return postOAuth(
		instanceUrl,
		{ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken },
		'gitea_oauth_error'
	);
}

function tokenHeaders(token: string): Record<string, string> {
	return { Authorization: `token ${token}`, Accept: 'application/json' };
}

export async function getAuthenticatedUser(instanceUrl: string, token: string): Promise<{ id: string; login: string }> {
	const res = await fetch(`${instanceUrl}/api/v1/user`, { headers: tokenHeaders(token) });
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new ApiError(502, 'gitea_api_error', text ? text.slice(0, 200) : undefined);
	}
	const json = (await res.json()) as { id?: unknown; login?: unknown; username?: unknown };
	const id = json.id;
	const login = typeof json.login === 'string' && json.login ? json.login : typeof json.username === 'string' ? json.username : '';
	if ((typeof id !== 'number' && typeof id !== 'string') || !login) throw new ApiError(502, 'gitea_api_error', 'missing user identity');
	return { id: String(id), login };
}

export async function listUserRepos(instanceUrl: string, token: string, opts?: { maxPages?: number }): Promise<RepoInfo[]> {
	const maxPages = opts?.maxPages ?? 10;
	const out: RepoInfo[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const res = await fetch(`${instanceUrl}/api/v1/user/repos?limit=50&page=${page}`, { headers: tokenHeaders(token) });
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new ApiError(502, 'gitea_api_error', text ? text.slice(0, 200) : undefined);
		}
		const mapped = mapGiteaRepoPage(await res.json());
		out.push(...mapped);
		if (mapped.length < 50) break;
	}
	return out;
}

export async function createRepoHook(instanceUrl: string, token: string, repoFullName: string, hookUrl: string, secret: string): Promise<void> {
	const [owner, repo] = repoFullName.split('/');
	if (!owner || !repo) return;
	const res = await fetch(`${instanceUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`, {
		method: 'POST',
		headers: { ...tokenHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({
			type: 'gitea',
			config: { url: hookUrl, content_type: 'json', secret },
			events: ['push'],
			active: true
		})
	});
	if (res.ok || res.status === 409) return;
	if (res.status === 403 || res.status === 404) return;
	const text = await res.text().catch(() => '');
	throw new ApiError(502, 'gitea_api_error', text ? text.slice(0, 200) : undefined);
}

export async function probeInstance(instanceUrl: string): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`${instanceUrl}/api/v1/version`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});
	} catch {
		throw new ApiError(502, 'gitea_unreachable', 'Could not reach the instance from the API. Check the URL and that the API can route to it.');
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new ApiError(502, 'gitea_unreachable', text ? text.slice(0, 200) : undefined);
	}
}
