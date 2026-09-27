export type GiteaWebhookAction = { kind: 'push'; repoFullName: string; branch: string } | { kind: 'ignored'; reason: string };

export function parseGiteaWebhookEvent(event: string, payload: unknown): GiteaWebhookAction {
	if (event !== 'push') return { kind: 'ignored', reason: event };
	const p = (payload ?? {}) as Record<string, unknown>;
	const ref = typeof p.ref === 'string' ? p.ref : '';
	const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
	const headSha = typeof p.after === 'string' ? p.after : '';
	const repo = p.repository as { full_name?: unknown } | undefined;
	const repoFullName = typeof repo?.full_name === 'string' ? repo.full_name : '';
	if (!branch || !repoFullName || p.deleted === true || /^0+$/.test(headSha)) return { kind: 'ignored', reason: 'push: non-branch or deleted' };
	return { kind: 'push', repoFullName, branch };
}
