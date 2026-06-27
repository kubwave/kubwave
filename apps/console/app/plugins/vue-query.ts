import { QueryClient, VueQueryPlugin, dehydrate, hydrate, type DehydratedState } from '@tanstack/vue-query';

// SSR state transfer is hand-rolled (dehydrate on app:rendered → hydrate on client); do NOT add a TanStack Nuxt module, it would double-hydrate.
export default defineNuxtPlugin(nuxtApp => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { staleTime: 30_000, refetchOnWindowFocus: false }
		}
	});
	nuxtApp.vueApp.use(VueQueryPlugin, { queryClient });

	if (import.meta.server) {
		nuxtApp.hooks.hook('app:rendered', () => {
			nuxtApp.payload.vueQueryState = dehydrate(queryClient);
		});
	}
	if (import.meta.client) {
		hydrate(queryClient, nuxtApp.payload.vueQueryState as DehydratedState | null);
	}
});
