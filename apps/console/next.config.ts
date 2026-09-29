import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
	output: 'standalone',
	// Workspace deps (@kubwave/api-client) live outside this app; trace from the monorepo root.
	outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
	transpilePackages: ['@kubwave/api-client'],
	// Prod runs on a read-only root filesystem, so nothing may write to .next/cache at runtime.
	images: { unoptimized: true },
	devIndicators: false,
	allowedDevOrigins: ['console.localhost', '127.0.0.1'],
	// No framing: the login and OAuth consent pages would otherwise be open to clickjacking.
	// Production only, so dev previews that embed the console keep working.
	async headers() {
		if (process.env.NODE_ENV === 'development') return [];
		return [
			{
				source: '/:path*',
				headers: [
					{ key: 'X-Frame-Options', value: 'DENY' },
					{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }
				]
			}
		];
	},
	// In-cluster the ingress routes /api and the OAuth discovery docs to the API. Plain `next dev`
	// has no ingress, so forward them same-origin. WebSocket upgrades are not proxied here.
	async rewrites() {
		if (process.env.NODE_ENV !== 'development') return [];
		return [
			{ source: '/api/:path*', destination: `${internalApiUrl}/api/:path*` },
			{ source: '/.well-known/:path*', destination: `${internalApiUrl}/.well-known/:path*` }
		];
	}
};

export default nextConfig;
