import { useQueryClient } from '@tanstack/vue-query';
import { setAccessToken } from '~/utils/token-store';
import type { AuthSessionResponse } from '@kubwave/api-client';

export type SessionUser = AuthSessionResponse['user'];

// Shared session-user state (Nuxt cross-render singleton), seeded by the session plugins.
export function useSessionUser() {
	return useState<SessionUser | null>('session-user', () => null);
}

export function useAuth() {
	const user = useSessionUser();
	const api = useApi();
	const queryClient = useQueryClient();

	// Best-effort server logout, then clear the local token + session state and redirect.
	async function logout() {
		try {
			await apiData(api.auth.logout.post());
		} catch {}
		setAccessToken(null);
		user.value = null;
		// Clear all cached queries so the next user can't read the previous user's data.
		queryClient.clear();
		await navigateTo('/auth/login', { replace: true });
	}

	return { user, logout };
}
