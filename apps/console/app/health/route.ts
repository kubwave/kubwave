export const dynamic = 'force-dynamic';

// Startup, readiness and liveness probe of the console Deployment.
export function GET() {
	return new Response('ok\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
