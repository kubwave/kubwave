// Optional GitHub token. The kubwave repo and its ghcr.io images are public, so none is
// required; a token only raises GitHub API rate limits for release lookups.
export async function resolveGithubToken(): Promise<string | undefined> {
	return process.env['GITHUB_TOKEN'] || undefined;
}

export function authHint(): string {
	return 'Optionally set GITHUB_TOKEN to raise GitHub API rate limits (the kubwave repo and images are public).';
}
