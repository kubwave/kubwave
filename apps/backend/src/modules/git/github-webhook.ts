export interface WebhookRepo {
	fullName: string;
	isPrivate: boolean;
}

export type WebhookAction =
	| { kind: 'installation-deleted'; githubInstallationId: string }
	| { kind: 'installation-suspended'; githubInstallationId: string; suspended: boolean }
	| { kind: 'repos-added'; githubInstallationId: string; repos: WebhookRepo[] }
	| { kind: 'repos-removed'; githubInstallationId: string; repoFullNames: string[] }
	| { kind: 'push'; githubInstallationId: string; repoFullName: string; branch: string; headSha: string }
	| { kind: 'ignored'; reason: string };

function installationId(payload: Record<string, unknown>): string | null {
	const inst = payload.installation as { id?: unknown } | undefined;
	const id = inst?.id;
	return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
}

function mapRepos(items: unknown): WebhookRepo[] {
	if (!Array.isArray(items)) return [];
	const out: WebhookRepo[] = [];
	for (const it of items) {
		const o = it as { full_name?: unknown; private?: unknown };
		if (typeof o.full_name === 'string') out.push({ fullName: o.full_name, isPrivate: o.private !== false });
	}
	return out;
}

// Normalize a GitHub webhook into the state change it implies. `installation.created` is intentionally ignored:
// the row is created by the authenticated setup redirect (which knows the owning team), not here.
export function parseWebhookEvent(event: string, payload: unknown): WebhookAction {
	const p = (payload ?? {}) as Record<string, unknown>;
	const id = installationId(p);
	if (!id) return { kind: 'ignored', reason: `${event}: no installation id` };
	const action = typeof p.action === 'string' ? p.action : '';

	if (event === 'installation') {
		if (action === 'deleted') return { kind: 'installation-deleted', githubInstallationId: id };
		if (action === 'suspend') return { kind: 'installation-suspended', githubInstallationId: id, suspended: true };
		if (action === 'unsuspend') return { kind: 'installation-suspended', githubInstallationId: id, suspended: false };
		return { kind: 'ignored', reason: `installation.${action}` };
	}

	if (event === 'installation_repositories') {
		if (action === 'added') return { kind: 'repos-added', githubInstallationId: id, repos: mapRepos(p.repositories_added) };
		if (action === 'removed') {
			return { kind: 'repos-removed', githubInstallationId: id, repoFullNames: mapRepos(p.repositories_removed).map(r => r.fullName) };
		}
		return { kind: 'ignored', reason: `installation_repositories.${action}` };
	}

	if (event === 'push') {
		const ref = typeof p.ref === 'string' ? p.ref : '';
		const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
		const headSha = typeof p.after === 'string' ? p.after : '';
		const repo = p.repository as { full_name?: unknown } | undefined;
		const repoFullName = typeof repo?.full_name === 'string' ? repo.full_name : '';
		// Ignore tag pushes and branch deletions (after is all-zero) — nothing to deploy.
		if (!branch || !repoFullName || p.deleted === true || /^0+$/.test(headSha)) return { kind: 'ignored', reason: 'push: non-branch or deleted' };
		return { kind: 'push', githubInstallationId: id, repoFullName, branch, headSha };
	}

	return { kind: 'ignored', reason: event };
}
