export function parseWatchPathsTextarea(text: string): string[] {
	return text
		.split('\n')
		.map(path => path.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
		.filter(Boolean);
}

/** Omits watchPaths when watching the whole repo so stale textarea content is not persisted. */
export function watchPathConfigFields(watchPathsText: string, watchEntireRepo: boolean): { watchPaths?: string[]; watchEntireRepo?: true } {
	if (watchEntireRepo) return { watchEntireRepo: true };
	const watchPaths = parseWatchPathsTextarea(watchPathsText);
	return watchPaths.length > 0 ? { watchPaths } : {};
}
