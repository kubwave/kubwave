import { isPublicPath, loginPath } from './auth-paths';

export type SetupStatus = { initialized: boolean; registryConfigured: boolean };

export type AuthState = {
	pathname: string;
	// Path plus query, kept whole for the post-login round-trip (e.g. MCP consent with its OAuth query).
	fullPath: string;
	signedIn: boolean;
	setup: SetupStatus;
};

export type RouteDecision = { render: true } | { redirect: string };

const render: RouteDecision = { render: true };
const redirect = (location: string): RouteDecision => ({ redirect: location });

const isSetupPath = (pathname: string) => pathname === '/auth/setup' || pathname.startsWith('/auth/setup/');

// Where a full page load may go, given the session and platform setup state.
export function decideRoute({ pathname, fullPath, signedIn, setup }: AuthState): RouteDecision {
	if (signedIn) return decideSignedIn(pathname, setup);
	return decideSignedOut(pathname, fullPath, setup);
}

function decideSignedOut(pathname: string, fullPath: string, setup: SetupStatus): RouteDecision {
	if (!setup.initialized) return isSetupPath(pathname) ? render : redirect('/auth/setup');
	if (isSetupPath(pathname)) return redirect('/auth/login');
	if (isPublicPath(pathname)) return render;
	return redirect(loginPath(fullPath));
}

function decideSignedIn(pathname: string, setup: SetupStatus): RouteDecision {
	// The first admin finishes setup by configuring the build registry; until then only setup renders.
	if (!setup.registryConfigured) return isSetupPath(pathname) ? render : redirect('/auth/setup');
	if (isPublicPath(pathname)) return redirect('/');
	return render;
}

const STATIC_FILE = /\.(?:ico|png|jpg|jpeg|svg|gif|webp|css|js|mjs|map|woff2?|ttf|eot|txt|webmanifest|json)$/i;

// Requests that never render a page. Known extensions only: a catch-all /\.\w+$/ would also exempt
// real routes with a dotted segment (e.g. /team/projects/my.app) and bypass auth.
export function isExemptPath(pathname: string): boolean {
	return (
		pathname.startsWith('/_next/') ||
		pathname.startsWith('/api/') ||
		pathname.startsWith('/.well-known/') ||
		pathname === '/health' ||
		STATIC_FILE.test(pathname)
	);
}

// Client navigations fetch RSC payloads and prefetch routes through the same paths. Only full page
// loads exchange the refresh cookie; client navigations are guarded in the browser.
export function isDocumentRequest(headers: Headers): boolean {
	return !headers.has('rsc') && !headers.has('next-router-prefetch');
}

// Absolute URL for a redirect as the browser sees it. Next would otherwise use its own listen
// address; behind the ingress the Host header and X-Forwarded-Proto carry the public origin.
export function publicUrl(path: string, headers: Headers, fallback: URL): URL {
	const host = headers.get('host');
	if (!host) return new URL(path, fallback);
	const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || fallback.protocol.replace(':', '');
	return new URL(path, `${proto}://${host}`);
}
