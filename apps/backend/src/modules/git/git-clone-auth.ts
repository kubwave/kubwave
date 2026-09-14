// Authenticate git-over-HTTPS WITHOUT putting the token in the URL or argv,
// so it can never leak into git's stderr, poll errors, or build logs. Applied via git's http.<origin>.extraheader.

export function basicAuthHeader(token: string): string {
	return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}

export function giteaTokenAuthHeader(token: string): string {
	return `Authorization: token ${token}`;
}

// Scopes the header to the repo's origin, e.g. http.https://github.com/.extraheader
export function extraHeaderConfigKey(repoUrl: string): string {
	const origin = new URL(repoUrl).origin;
	return `http.${origin}/.extraheader`;
}

export function gitHeaderAuthEnv(repoUrl: string, headerValue: string): Record<string, string> {
	return {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: extraHeaderConfigKey(repoUrl),
		GIT_CONFIG_VALUE_0: headerValue
	};
}

// Env that injects the GitHub App token header into any git subprocess (GIT_CONFIG_* needs git ≥ 2.31).
export function gitTokenAuthEnv(repoUrl: string, token: string): Record<string, string> {
	return gitHeaderAuthEnv(repoUrl, basicAuthHeader(token));
}
