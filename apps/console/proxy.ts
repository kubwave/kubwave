import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_TOKEN_HEADER } from '@/lib/auth/request-token';
import { decideRoute, isDocumentRequest, isExemptPath, publicUrl } from '@/lib/auth/route-policy';
import { fetchSetupStatus, refreshSession } from '@/lib/auth/session-exchange';

// On full page loads: exchange the refresh cookie, relay the rotated cookie, enforce the setup and
// sign-in redirects, and hand the access token to server rendering via a request header.
export async function proxy(request: NextRequest) {
	// Never trust a client-supplied token header; only this proxy may set it.
	const forwarded = new Headers(request.headers);
	forwarded.delete(ACCESS_TOKEN_HEADER);

	const { pathname, search } = request.nextUrl;
	if (isExemptPath(pathname) || !isDocumentRequest(request.headers)) return NextResponse.next({ request: { headers: forwarded } });

	const [session, setup] = await Promise.all([refreshSession(request.cookies.get('refresh_token')?.value), fetchSetupStatus()]);
	const decision = decideRoute({ pathname, fullPath: pathname + search, signedIn: session !== null, setup });

	if (session && 'render' in decision) forwarded.set(ACCESS_TOKEN_HEADER, session.accessToken);
	const response =
		'redirect' in decision
			? NextResponse.redirect(publicUrl(decision.redirect, request.headers, request.nextUrl), 302)
			: NextResponse.next({ request: { headers: forwarded } });
	for (const cookie of session?.setCookies ?? []) response.headers.append('set-cookie', cookie);
	return response;
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|api/|\\.well-known/|health$|favicon\\.ico$).*)']
};
