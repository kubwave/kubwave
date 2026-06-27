// Pages allowed signed-out (and redirected away from when signed-in). Shared by the
// Nitro server middleware and the client route guard so they can't drift.
export const PUBLIC_PREFIXES = ['/auth/login', '/auth/setup', '/auth/accept'];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
