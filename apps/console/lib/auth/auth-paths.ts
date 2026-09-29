// Pages allowed signed-out (and redirected away from when signed-in). Shared by the proxy
// and the client route guard so they cannot drift.
export const PUBLIC_PREFIXES = ['/auth/login', '/auth/setup', '/auth/accept', '/auth/forgot', '/auth/reset'];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Login URL that returns to `target` afterwards (e.g. an MCP consent page with its OAuth query).
export function loginPath(target: string): string {
	return target === '/' ? '/auth/login' : `/auth/login?redirect=${encodeURIComponent(target)}`;
}

const PLACEHOLDER_ORIGIN = 'http://console.invalid';

// Only same-origin paths. Resolving with the URL parser catches every browser normalization
// (`//host`, `/\host`, tabs or newlines stripped into `//host`) instead of guessing them.
export function safeRedirect(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/')) return '/';
	const url = new URL(value, PLACEHOLDER_ORIGIN);
	return url.origin === PLACEHOLDER_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : '/';
}
