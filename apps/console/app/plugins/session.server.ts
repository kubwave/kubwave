// SSR session fetch: event.context.accessToken (set only on a successful refresh) means authenticated, so
// fetch the session user for a flash-free first render. On failure leave it null — the client guard covers the redirect.
export default defineNuxtPlugin(async () => {
	const event = useRequestEvent();
	if (!event?.context.accessToken) return; // unauthenticated → auth pages
	const api = useApi();
	const user = useSessionUser();
	try {
		const data = await apiData(api.auth.session.get());
		user.value = data.user;
	} catch {
		user.value = null;
	}
});
