/** Trim and strip leading/trailing slashes so watch/root paths are repo-relative prefixes. */
export function normalizeRepoRelativePath(path: string): string {
	return path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function normalizeWatchPaths(paths: string[] | undefined): string[] | undefined {
	if (!paths?.length) return undefined;
	const normalized = [...new Set(paths.map(normalizeRepoRelativePath).filter(Boolean))];
	return normalized.length > 0 ? normalized : undefined;
}
