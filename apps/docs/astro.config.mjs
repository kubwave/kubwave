import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://docs.kubwave.com',
	// Dev only: served in-cluster behind Traefik at docs.localhost (Tilt). Vite 6
	// blocks unknown Host headers, so allow the dev ingress host. Ignored by build.
	vite: {
		server: {
			allowedHosts: ['docs.localhost']
		}
	},
	integrations: [
		starlight({
			title: 'kubwave',
			description: 'The self-hosted PaaS for your apps. Open-source. Kubernetes-native.',
			logo: {
				src: './src/assets/logo.png',
				replacesTitle: true
			},
			favicon: '/favicon.ico',
			head: [{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/logo.png' } }],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/kubwave/kubwave' }],
			editLink: {
				baseUrl: 'https://github.com/kubwave/kubwave/edit/main/apps/docs/'
			},
			customCss: ['./src/styles/custom.css'],
			lastUpdated: true,
			pagination: true,
			// Custom landing hero (dark-first developer-tool look) replaces the default splash hero.
			components: {
				Hero: './src/components/Hero.astro'
			},
			// Code blocks: dark-first techy theme + terminal framing. Themes are bundled Shiki strings.
			expressiveCode: {
				themes: ['github-dark', 'github-light'],
				styleOverrides: {
					borderRadius: '0.5rem',
					codeFontFamily: 'var(--sl-font-mono)',
					frames: {
						terminalTitlebarBackground: '#0d0f1a',
						terminalTitlebarForeground: '#a0eefa',
						terminalTitlebarDotsForeground: '#4b4f6b',
						terminalBackground: '#0a0b14',
						editorTabBarBackground: '#0d0f1a',
						editorActiveTabBackground: '#0a0b14',
						shadowColor: 'transparent'
					}
				}
			},
			sidebar: [
				{
					label: 'Get Started',
					items: [
						{ label: 'Introduction', slug: 'start/introduction' },
						{ label: 'Quickstart', slug: 'start/quickstart' },
						{ label: 'Supported providers', slug: 'start/supported-providers' },
						{ label: 'Architecture', slug: 'start/architecture' }
					]
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Deploy a service', slug: 'guides/deploy-a-service' },
						{ label: 'Configure a service', slug: 'guides/configure-a-service' },
						{ label: 'Tenant isolation', slug: 'guides/tenant-isolation' },
						{ label: 'Contributing to docs', slug: 'guides/contributing-to-docs' }
					]
				},
				{
					label: 'Templates',
					items: [
						{ label: 'Overview', slug: 'templates' },
						{ label: 'Supabase', slug: 'templates/supabase' },
						{ label: 'Ghost', slug: 'templates/ghost' },
						{ label: 'Uptime Kuma', slug: 'templates/uptime-kuma' }
					]
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Helm chart', slug: 'reference/helm-chart' },
						{ label: 'Environment variables', slug: 'reference/environment-variables' }
					]
				}
			]
		})
	]
});
