// Client-side route guard for client navigations; the Nitro server middleware only runs on hard loads.
import { isPublicPath } from '#shared/auth-paths';

export default defineNuxtRouteMiddleware(async to => {
	if (import.meta.server) return; // server middleware already enforced this
	const user = useSessionUser();
	const isSetupPath = to.path === '/auth/setup' || to.path.startsWith('/auth/setup/');
	if (!user.value && !isPublicPath(to.path)) return navigateTo('/auth/login');
	if (user.value) {
		const setup = await $fetch<{ registryConfigured: boolean }>('/api/setup/status').catch(() => ({ registryConfigured: true }));
		if (!setup.registryConfigured && !isSetupPath) return navigateTo('/auth/setup');
		if (isPublicPath(to.path) && !(!setup.registryConfigured && isSetupPath)) return navigateTo('/');
	}
});
