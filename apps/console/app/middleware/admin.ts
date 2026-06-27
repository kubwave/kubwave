// Defense-in-depth guard for /admin/*: the sidebar hides admin links, but direct nav should bounce home.
export default defineNuxtRouteMiddleware(() => {
	const user = useSessionUser();
	// Redirect only after user is confirmed non-admin; if unloaded (race), let the API 403 guard.
	if (user.value && !user.value.isAdmin) return navigateTo('/');
});
