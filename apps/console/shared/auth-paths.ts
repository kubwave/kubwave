// Pages allowed signed-out (and redirected away from when signed-in). Shared by the
// Nitro server middleware and the client route guard so they can't drift.
export const PUBLIC_PREFIXES = ['/auth/login', '/auth/setup', '/auth/accept', '/auth/forgot', '/auth/reset'];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Login URL that returns to `target` afterwards (e.g. an MCP consent page with its OAuth query).
export function loginPath(target: string): string {
	return target === '/' ? '/auth/login' : `/auth/login?redirect=${encodeURIComponent(target)}`;
}

// Only same-origin paths; rejects `//host` and `/\host` open redirects.
export function safeRedirect(value: unknown): string {
	return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/';
}
