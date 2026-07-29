export type NavItem = {
	readonly title: string;
	readonly path: string;
};

export type NavGroup = {
	readonly title: string;
	readonly items: readonly NavItem[];
};

export const docsNav = [
	{
		title: 'Get Started',
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
			{ title: 'Infomaniak PCK', path: '/providers/infomaniak-pck' }
		]
	},
	{
		title: 'Guides',
		items: [
			{ title: 'Deploy a service', path: '/guides/deploy-a-service' },
			{ title: 'Configure a service', path: '/guides/configure-a-service' },
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
			{ title: 'Uptime Kuma', path: '/templates/uptime-kuma' }
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
] as const satisfies readonly NavGroup[];

export type Pager = {
	readonly previous?: NavItem;
	readonly next?: NavItem;
};

const flatNav: NavItem[] = [];
for (const group of docsNav) {
	flatNav.push(...group.items);
}
const pagerIndexByPath = new Map(flatNav.map((item, index) => [item.path, index]));

export function normalizeDocsPath(path: string): string {
	if (path === '/') return path;
	return path.replace(/\/$/, '');
}

export function flatDocsNav(): readonly NavItem[] {
	return flatNav;
}

export function getDocsPager(path: string): Pager {
	const index = pagerIndexByPath.get(normalizeDocsPath(path));
	if (index === undefined) return {};

	return {
		previous: flatNav[index - 1],
		next: flatNav[index + 1]
	};
}
