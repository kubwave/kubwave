import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
	compatibilityDate: '2026-06-01',
	modules: ['shadcn-nuxt', '@nuxtjs/color-mode', '@nuxt/fonts'],
	css: ['~/assets/css/main.css'],
	// Component name = filename, ignoring folder path, so reorganizing nesting is safe.
	components: [{ path: '~/components', pathPrefix: false }],
	devtools: { enabled: true },
	colorMode: { classSuffix: '' },
	shadcn: { prefix: '', componentDir: '~/components/ui' },
	// titleTemplate lives in app.vue's useHead, not here — it's a function and nuxt.config app.head must be serializable.
	app: {
		pageTransition: { name: 'page', mode: 'out-in' },
		head: {
			htmlAttrs: { lang: 'en' },
			meta: [{ name: 'description', content: 'Self-hosted kubwave control plane' }],
			link: [
				{ rel: 'icon', href: '/favicon.ico', sizes: 'any' },
				{ rel: 'apple-touch-icon', href: '/logo.png' }
			]
		}
	},
	// Bundle these so SSR uses a single Vue instance — externalized reka-ui pulls a second (CJS) Vue copy and breaks renderSlot in prod.
	build: { transpile: ['reka-ui', '@tanstack/vue-form'] },
	nitro: {
		// Local dev: forward same-origin /api (incl. flow-layout WebSocket via ws:true) to the backend; in prod/k3d the ingress routes /api first.
		devProxy: {
			'/api': { target: `${process.env.INTERNAL_API_URL ?? 'http://localhost:3001'}/api`, changeOrigin: true, ws: true }
		}
	},
	vite: {
		plugins: [tailwindcss()],
		// Pre-bundle deps Vite's import crawler misses on first scan, preventing mid-dev page reloads.
		optimizeDeps: {
			include: ['@tanstack/vue-query', '@kubwave/api-client']
		}
	}
});
