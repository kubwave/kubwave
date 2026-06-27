import { getAccessToken, refreshAccessToken } from '~/utils/token-store';

// Prime the in-memory access token from the refresh cookie so vue-query calls are authenticated after a fresh load.
export default defineNuxtPlugin(() => {
	const user = useSessionUser();
	if (getAccessToken()) return;
	void refreshAccessToken().then(token => {
		if (!token) user.value = null;
	});
});
