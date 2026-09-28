import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';
import { InstallCommand } from '@/components/mdx/client';
import { GithubMark } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { docsNav, repoUrl } from '@/lib/nav';

const steps = [
	{
		title: 'Install the CLI',
		text: 'One script drops a single binary into ~/.local/bin and starts the installer.',
		href: '/start/quickstart/#1-install-the-cli'
	},
	{
		title: 'Run the installer',
		text: 'Pick a provider, a console domain, and an ACME email. The CLI applies the Helm chart.',
		href: '/start/quickstart/#2-run-the-installer'
	},
	{ title: 'Open the console', text: 'Create the admin account, a project, and your first service.', href: '/start/quickstart/#3-open-the-console' }
];

const principles = [
	{ title: 'One binary, full stack', text: 'A single CLI boots the whole platform: API, console, worker, database, and ingress.' },
	{
		title: 'You own the cluster',
		text: 'Runs on your own infrastructure. Bring your own Kubernetes, or use a managed platform like Cloudfleet on Hetzner.'
	},
	{
		title: 'Open by default',
		text: 'Open-source API, console, and Helm chart. The chart is the single source of truth for what lands in the cluster.'
	},
	{ title: 'Replaceable pieces', text: 'cert-manager TLS, Traefik routing, and Postgres included. Swappable parts, not a black box.' }
];

const providers = [
	{ name: 'Cloudfleet (Hetzner)', id: 'cloudfleet-hetzner', href: '/providers/cloudfleet-hetzner/' },
	{ name: 'Cloudfleet (Google Cloud)', id: 'cloudfleet-gcp', href: '/providers/cloudfleet-gcp/' },
	{ name: 'UpCloud UKS', id: 'upcloud-uks', href: '/providers/upcloud-uks/' },
	{ name: 'Infomaniak PCK', id: 'infomaniak-pck', href: '/providers/infomaniak-pck/' }
];

const tasks = [
	{ title: 'Deploy from GitHub', href: '/guides/deploy-a-service/#deploy-from-github' },
	{ title: 'Import a docker-compose file', href: '/guides/deploy-a-service/#import-from-docker-compose' },
	{ title: 'Reference another service', href: '/guides/configure-a-service/#service-references' },
	{ title: 'Add a custom domain', href: '/guides/configure-a-service/#custom-domains' },
	{ title: 'Turn on PR previews', href: '/guides/configure-a-service/#pr-previews' },
	{ title: 'Roll back a deployment', href: '/guides/deploy-a-service/#deployments-and-rollback' },
	{ title: 'Sandbox tenants with gVisor', href: '/guides/tenant-isolation/#enabling-gvisor' },
	{ title: 'Upgrade kubwave', href: '/reference/cli/#kubwave-update' }
];

const templates = [
	{ title: 'Supabase', text: 'Postgres, Auth, REST, Realtime, and Storage behind Kong, with Studio.', href: '/templates/supabase/' },
	{ title: 'Ghost', text: 'The Ghost publishing platform with its own MySQL.', href: '/templates/ghost/' },
	{ title: 'Uptime Kuma', text: 'Uptime monitoring with a status page.', href: '/templates/uptime-kuma/' },
	{ title: 'Kodus', text: 'AI code review on your pull requests. Bring your own LLM key.', href: '/templates/kodus/' }
];

function Section({ title, action, children }: { title: string; action?: { label: string; href: string }; children: React.ReactNode }) {
	return (
		<section className="border-t pt-8">
			<div className="mb-5 flex items-baseline justify-between gap-4">
				<h2 className="text-lg font-semibold tracking-tight">{title}</h2>
				{action && (
					<Link href={action.href} className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
						{action.label}
						<ArrowRightIcon className="size-3.5" />
					</Link>
				)}
			</div>
			{children}
		</section>
	);
}

export default function HomePage() {
	return (
		<main className="mx-auto max-w-5xl space-y-16 px-4 py-16 sm:px-6 sm:py-20">
			<div>
				<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">kubwave documentation</h1>
				<p className="mt-3 max-w-2xl text-muted-foreground">
					kubwave is an open-source, self-hosted PaaS for Kubernetes. Install it on your own cluster, then deploy services from images, Dockerfiles,
					or Git.
				</p>
				<div className="mt-6 flex flex-wrap gap-2">
					<Button asChild>
						<Link href="/start/quickstart/">
							Quickstart
							<ArrowRightIcon />
						</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link href="/start/introduction/">Introduction</Link>
					</Button>
					<Button variant="ghost" asChild>
						<a href={repoUrl} target="_blank" rel="noreferrer">
							<GithubMark className="size-4" />
							GitHub
						</a>
					</Button>
				</div>
				<div className="max-w-2xl">
					<InstallCommand />
				</div>
			</div>

			<Section title="From zero to a running platform" action={{ label: 'Full quickstart', href: '/start/quickstart/' }}>
				<ol className="grid gap-6 sm:grid-cols-3">
					{steps.map((step, index) => (
						<li key={step.title}>
							<Link href={step.href} className="group block">
								<span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
								<p className="mt-1.5 font-medium group-hover:text-primary-text">{step.title}</p>
								<p className="mt-1 text-sm leading-6 text-muted-foreground">{step.text}</p>
							</Link>
						</li>
					))}
				</ol>
			</Section>

			<Section title="Why kubwave" action={{ label: 'Architecture', href: '/start/architecture/' }}>
				<dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
					{principles.map(item => (
						<div key={item.title}>
							<dt className="font-medium">{item.title}</dt>
							<dd className="mt-1 text-sm leading-6 text-muted-foreground">{item.text}</dd>
						</div>
					))}
				</dl>
			</Section>

			<div className="grid gap-16 lg:grid-cols-2 lg:gap-10">
				<Section title="Providers" action={{ label: 'All providers', href: '/start/supported-providers/' }}>
					<ul className="divide-y rounded-lg border">
						{providers.map(provider => (
							<li key={provider.id}>
								<Link href={provider.href} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent">
									<span className="flex-1 font-medium">{provider.name}</span>
									<code className="font-mono text-xs text-muted-foreground">{provider.id}</code>
								</Link>
							</li>
						))}
					</ul>
					<p className="mt-3 text-sm text-muted-foreground">Coming soon: EKS, GKE, AKS, DigitalOcean, Vultr, Cloudfleet (AWS).</p>
				</Section>

				<Section title="Common tasks">
					<ul className="grid gap-x-6 sm:grid-cols-2">
						{tasks.map(task => (
							<li key={task.href}>
								<Link href={task.href} className="group flex items-center justify-between gap-3 border-b py-2.5 text-sm">
									<span className="text-muted-foreground transition-colors group-hover:text-foreground">{task.title}</span>
									<ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
								</Link>
							</li>
						))}
					</ul>
				</Section>
			</div>

			<Section title="One-click templates" action={{ label: 'How templates work', href: '/templates/' }}>
				<ul className="grid gap-3 sm:grid-cols-2">
					{templates.map(template => (
						<li key={template.href}>
							<Link href={template.href} className="block h-full rounded-lg border px-4 py-3.5 transition-colors hover:bg-accent">
								<p className="text-sm font-medium">{template.title}</p>
								<p className="mt-1 text-sm leading-6 text-muted-foreground">{template.text}</p>
							</Link>
						</li>
					))}
				</ul>
			</Section>

			<Section title="All documentation">
				<div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
					{docsNav.map(group => (
						<div key={group.title}>
							<h3 className="text-sm font-medium">{group.title}</h3>
							<ul className="mt-3 space-y-2 text-sm">
								{group.items.map(item => (
									<li key={item.path}>
										<Link href={`${item.path}/`} className="text-muted-foreground transition-colors hover:text-foreground">
											{item.title}
										</Link>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</Section>
		</main>
	);
}
