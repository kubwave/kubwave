export type NavItem = { title: string; path: string };
export type NavGroup = { title: string; items: NavItem[] };
export type NavEntry = NavItem & { group: string };
export type Pager = { previous?: NavEntry; next?: NavEntry };

// Paths map 1:1 to content/<path>.mdx.
export const docsNav: NavGroup[] = [
	{
		title: 'Get started',
		items: [
			{ title: 'Introduction', path: '/start/introduction' },
			{ title: 'Quickstart', path: '/start/quickstart' },
			{ title: 'Supported providers', path: '/start/supported-providers' },
			{ title: 'Architecture', path: '/start/architecture' }
		]
	},
	{
		title: 'Provider setup',
		items: [
			{ title: 'Cloudfleet (Hetzner)', path: '/providers/cloudfleet-hetzner' },
			{ title: 'Cloudfleet (Google Cloud)', path: '/providers/cloudfleet-gcp' },
			{ title: 'UpCloud UKS', path: '/providers/upcloud-uks' },
			{ title: 'Infomaniak PCK', path: '/providers/infomaniak-pck' },
			{ title: 'k3s', path: '/providers/k3s' }
		]
	},
	{
		title: 'Guides',
		items: [
			{ title: 'Deploy a service', path: '/guides/deploy-a-service' },
			{ title: 'Configure a service', path: '/guides/configure-a-service' },
			{ title: 'Build servers', path: '/guides/build-servers' },
			{ title: 'Tenant isolation', path: '/guides/tenant-isolation' },
			{ title: 'Contributing to docs', path: '/guides/contributing-to-docs' }
		]
	},
	{
		title: 'Templates',
		items: [
			{ title: 'Overview', path: '/templates' },
			{ title: 'Supabase', path: '/templates/supabase' },
			{ title: 'Ghost', path: '/templates/ghost' },
			{ title: 'Uptime Kuma', path: '/templates/uptime-kuma' },
			{ title: 'Kodus', path: '/templates/kodus' }
		]
	},
	{
		title: 'Reference',
		items: [
			{ title: 'CLI', path: '/reference/cli' },
			{ title: 'Helm chart', path: '/reference/helm-chart' },
			{ title: 'Environment variables', path: '/reference/environment-variables' }
		]
	}
];

export const flatNav: NavEntry[] = docsNav.flatMap(group => group.items.map(item => ({ ...item, group: group.title })));

export const repoUrl = 'https://github.com/kubwave/kubwave';

const withoutTrailingSlash = (path: string) => path.replace(/(.)\/$/, '$1');

export function findNavEntry(path: string): NavEntry | undefined {
	return flatNav.find(entry => entry.path === withoutTrailingSlash(path));
}

export function getPager(path: string): Pager {
	const index = flatNav.findIndex(entry => entry.path === withoutTrailingSlash(path));
	if (index === -1) return {};
	return { previous: flatNav[index - 1], next: flatNav[index + 1] };
}
