// Authenticate git-over-HTTPS with a GitHub App installation token WITHOUT putting it in the URL or argv,
// so it can never leak into git's stderr, poll errors, or build logs. Applied via git's http.<origin>.extraheader.

export function basicAuthHeader(token: string): string {
	return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}

// Scopes the header to the repo's origin, e.g. http.https://github.com/.extraheader
export function extraHeaderConfigKey(repoUrl: string): string {
	const origin = new URL(repoUrl).origin;
	return `http.${origin}/.extraheader`;
}

// Env that injects the auth header into any git subprocess (GIT_CONFIG_* needs git ≥ 2.31).
export function gitTokenAuthEnv(repoUrl: string, token: string): Record<string, string> {
	return {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: extraHeaderConfigKey(repoUrl),
		GIT_CONFIG_VALUE_0: basicAuthHeader(token)
	};
}
