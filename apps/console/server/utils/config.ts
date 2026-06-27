// Absolute base URL the server uses to reach the backend API (browser uses same-origin /api).
// On process.env (not runtimeConfig) to preserve the Helm env contract.
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';
