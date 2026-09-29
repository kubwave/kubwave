// Next passes repeated query keys as arrays; the console only ever reads the first value.
export function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

// A query value narrowed to the allowed options, e.g. a tab name.
export function oneOf<T extends string>(value: string | null | undefined, options: readonly T[], fallback: T): T {
	return options.includes(value as T) ? (value as T) : fallback;
}

// The query string with some keys set (string) or removed (null), keeping all others.
export function withSearchParams(search: string, patch: Record<string, string | null>): string {
	const params = new URLSearchParams(search);
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) params.delete(key);
		else params.set(key, value);
	}
	const query = params.toString();
	return query ? `?${query}` : '';
}

// Rewrites the current URL's query in place. Next syncs native history updates with
// useSearchParams, so UI state (tabs) lands in the URL without a server round trip.
export function replaceSearchParams(patch: Record<string, string | null>): void {
	const search = withSearchParams(window.location.search, patch);
	window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
}
