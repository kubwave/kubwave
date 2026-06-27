import { appendResponseHeader, defineEventHandler, getCookie, sendRedirect } from 'h3';
import { refreshSession, fetchSetupStatus } from '#server/utils/auth';
import { isPublicPath } from '#shared/auth-paths';

// Skip non-HTML requests: Nuxt internals/assets, the API path (ingress-routed), and the health probe.
function isExemptPath(pathname: string): boolean {
	return (
		pathname.startsWith('/_nuxt') ||
		pathname.startsWith('/__nuxt') ||
		pathname.startsWith('/api/') ||
		pathname === '/health' ||
		pathname === '/favicon.ico' ||
		// Known extensions only; a catch-all /\.\w+$/ would also exempt real routes with a dotted segment (e.g. /team/projects/my.app), bypassing auth.
		/\.(?:ico|png|jpg|jpeg|svg|gif|webp|css|js|mjs|map|woff2?|ttf|eot|txt|webmanifest|json)$/i.test(pathname)
	);
}

// On every SSR page load, exchange refresh cookie for access token, relay rotated cookie, hand access token to render via event.context.
export default defineEventHandler(async event => {
	const pathname = event.path.split('?')[0] ?? event.path;
	if (isExemptPath(pathname)) return;

	const refreshToken = getCookie(event, 'refresh_token');
	const session = await refreshSession(refreshToken);

	// Relay the rotated refresh cookie whenever we refreshed, regardless of branch.
	if (session) {
		for (const cookie of session.setCookies) {
			appendResponseHeader(event, 'set-cookie', cookie);
		}
	}

	if (!session) {
		// Auth page depends on whether the first admin exists: pre-setup bounces to /auth/setup, post-setup never lingers there.
		const { initialized } = await fetchSetupStatus();
		const isSetupPath = pathname === '/auth/setup' || pathname.startsWith('/auth/setup/');

		if (!initialized) {
			return isSetupPath ? undefined : sendRedirect(event, '/auth/setup', 302);
		}
		// Set up: /auth/setup is dead → login; other public pages render, protected fall to login.
		if (isSetupPath) return sendRedirect(event, '/auth/login', 302);
		if (isPublicPath(pathname)) return;
		return sendRedirect(event, '/auth/login', 302);
	}

	const setupStatus = await fetchSetupStatus();
	const isSetupPath = pathname === '/auth/setup' || pathname.startsWith('/auth/setup/');
	if (!setupStatus.registryConfigured) {
		if (isSetupPath) {
			event.context.accessToken = session.accessToken;
			return;
		}
		return sendRedirect(event, '/auth/setup', 302);
	}

	if (isPublicPath(pathname)) {
		return sendRedirect(event, '/', 302);
	}

	// authed + protected → forward the fresh access token to the SSR render.
	event.context.accessToken = session.accessToken;
});
