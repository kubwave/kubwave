import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
	compatibilityDate: '2026-06-01',
	modules: ['@nuxt/content', 'shadcn-nuxt', '@nuxtjs/color-mode', '@nuxt/fonts'],
	css: ['~/assets/css/main.css'],
	components: [{ path: '~/components', pathPrefix: false }],
	ssr: true,
	devtools: { enabled: true },
	colorMode: { classSuffix: '', preference: 'dark', fallback: 'dark' },
	shadcn: { prefix: '', componentDir: '~/components/ui' },
	// `docsChannel` marks the release line this build represents ("latest" stable vs "next"
	// prerelease), baked at generate time via NUXT_PUBLIC_DOCS_CHANNEL; drives VersionSwitcher.
	runtimeConfig: {
		public: {
			docsChannel: 'latest',
			latestUrl: 'https://docs.kubwave.com',
			nextUrl: 'https://next.docs.kubwave.com'
		}
	},
	content: {
		build: {
			markdown: {
				highlight: {
					theme: { default: 'github-light', dark: 'github-dark' }
				}
			}
		}
	},
	fonts: {
		families: [
			{ name: 'Geist', provider: 'google', weights: [400, 500, 600, 700], subsets: ['latin'] },
			{ name: 'Geist Mono', provider: 'google', weights: [400, 500], subsets: ['latin'] }
		]
	},
	app: {
		pageTransition: { name: 'page', mode: 'out-in' },
		head: {
			htmlAttrs: { lang: 'en' },
			meta: [{ name: 'description', content: 'Self-hosted kubwave control plane documentation' }],
			link: [
				{ rel: 'icon', href: '/favicon.ico', sizes: 'any' },
				{ rel: 'apple-touch-icon', href: '/logo.png' }
			]
		}
	},
	devServer: { port: 4321 },
	build: { transpile: ['reka-ui'] },
	vite: {
		plugins: [tailwindcss()],
		server: { allowedHosts: ['docs.localhost'] }
	}
});
