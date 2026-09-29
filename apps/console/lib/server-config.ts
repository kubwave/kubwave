// Absolute base URL the server uses to reach the API; the browser uses same-origin /api.
// Read from process.env at runtime (Helm env contract), never baked in as NEXT_PUBLIC_*.
export function internalApiUrl(): string {
	return process.env.INTERNAL_API_URL ?? 'http://localhost:3001';
}
