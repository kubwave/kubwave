import type { GithubRepoServiceConfig, PrivateRepoServiceConfig, PublicRepoServiceConfig, ServiceConfig } from '@kubwave/db';
import { normalizeRepoRelativePath } from '../../../../shared/git/repo-relative-path.js';

// Prefixes that gate auto-deploy. Empty = watch the whole repo (current behavior).
export function effectiveWatchPaths(config: ServiceConfig): string[] {
	const repo = config as PublicRepoServiceConfig | PrivateRepoServiceConfig | GithubRepoServiceConfig;
	if (repo.watchEntireRepo === true) return [];

	const prefixes: string[] = [];
	const root = normalizeRepoRelativePath(repo.rootDirectory ?? '');
	if (root) prefixes.push(root);
	for (const path of repo.watchPaths ?? []) {
		const normalized = normalizeRepoRelativePath(path);
		if (normalized) prefixes.push(normalized);
	}
	return [...new Set(prefixes)];
}

export function pathMatchesPrefix(file: string, prefix: string): boolean {
	const normalizedFile = normalizeRepoRelativePath(file);
	const normalizedPrefix = normalizeRepoRelativePath(prefix);
	if (!normalizedFile || !normalizedPrefix) return false;
	return normalizedFile === normalizedPrefix || normalizedFile.startsWith(`${normalizedPrefix}/`);
}

export function pathsMatch(changedFiles: string[], prefixes: string[]): boolean {
	if (prefixes.length === 0) return true;
	return changedFiles.some(file => prefixes.some(prefix => pathMatchesPrefix(file, prefix)));
}
