'use client';

import {
	ArrowLeftIcon,
	BoxesIcon,
	CheckIcon,
	ContainerIcon,
	DatabaseIcon,
	FileCodeIcon,
	GitBranchIcon,
	KeyRoundIcon,
	LayoutTemplateIcon,
	Loader2Icon,
	SparklesIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { GitHubIcon } from '@/components/service/service-icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { databaseEngines, templates, type Service, type ServiceType } from '@/lib/mock';

type Field = { id: string; label: string; placeholder?: string; input?: 'textarea' | 'select'; options?: string[]; value?: string; mono?: boolean };
type Kind = {
	id: string;
	label: string;
	description: string;
	icon: React.ReactNode;
	type: ServiceType;
	fields: Field[];
	group: string;
	version?: string;
};

const nameField: Field = { id: 'name', label: 'Service name', placeholder: 'web', mono: true };

const composeSample = `services:
  app:
    image: ghcr.io/acme/app:latest
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://app@db:5432/app
  db:
    image: postgres:17
  cache:
    image: redis:7.4-alpine`;

const kinds: Kind[] = [
	{
		id: 'github',
		group: 'Deploy from source',
		label: 'GitHub repository',
		description: 'Build on every push via the GitHub App',
		icon: <GitHubIcon className="size-4" />,
		type: 'github-repo',
		fields: [
			{
				id: 'repo',
				label: 'Repository',
				input: 'select',
				options: ['acme/storefront-web', 'acme/marketing-site', 'acme/docs', 'acme/billing-service']
			},
			{ id: 'branch', label: 'Branch', value: 'main', mono: true },
			nameField
		]
	},
	{
		id: 'gitea',
		group: 'Deploy from source',
		label: 'Gitea repository',
		description: 'Connect a repository on your Gitea instance',
		icon: <GitBranchIcon className="size-4 text-chart-3" />,
		type: 'gitea-repo',
		fields: [
			{ id: 'repo', label: 'Repository', input: 'select', options: ['platform/jobs', 'platform/infra', 'tools/status-page'] },
			{ id: 'branch', label: 'Branch', value: 'main', mono: true },
			nameField
		]
	},
	{
		id: 'public',
		group: 'Deploy from source',
		label: 'Public repository',
		description: 'Any public Git URL, built with Nixpacks',
		icon: <GitBranchIcon className="size-4" />,
		type: 'public-repo',
		fields: [
			{ id: 'repo', label: 'Repository URL', placeholder: 'https://github.com/owner/repo', mono: true },
			{ id: 'branch', label: 'Branch', value: 'main', mono: true },
			nameField
		]
	},
	{
		id: 'private',
		group: 'Deploy from source',
		label: 'Private repository (SSH)',
		description: 'Clone with a team deploy key',
		icon: <KeyRoundIcon className="size-4" />,
		type: 'private-repo',
		fields: [
			{ id: 'repo', label: 'SSH URL', placeholder: 'git@git.example.com:team/repo.git', mono: true },
			{ id: 'branch', label: 'Branch', value: 'main', mono: true },
			{ id: 'key', label: 'Deploy key', input: 'select', options: ['ci-deploy · ed25519', 'legacy-jobs · rsa'] },
			nameField
		]
	},
	{
		id: 'image',
		group: 'Docker',
		label: 'Docker image',
		description: 'Run any image from a public or private registry',
		icon: <ContainerIcon className="size-4 text-chart-1" />,
		type: 'docker-image',
		fields: [{ id: 'repo', label: 'Image', placeholder: 'nginx:1.27-alpine', mono: true }, nameField]
	},
	{
		id: 'dockerfile',
		group: 'Docker',
		label: 'Dockerfile',
		description: 'Paste a Dockerfile, we build it in-cluster',
		icon: <FileCodeIcon className="size-4 text-chart-4" />,
		type: 'dockerfile',
		fields: [
			nameField,
			{ id: 'dockerfile', label: 'Dockerfile', input: 'textarea', value: 'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/', mono: true }
		]
	},
	{
		id: 'compose',
		group: 'Docker',
		label: 'Docker Compose',
		description: 'Import every service from a compose file',
		icon: <BoxesIcon className="size-4" />,
		type: 'docker-image',
		fields: [{ id: 'compose', label: 'docker-compose.yml', input: 'textarea', value: composeSample, mono: true }]
	},
	...databaseEngines.flatMap(e =>
		e.versions.map(v => ({
			id: `${e.type}-${v}`,
			group: 'Database',
			label: `${e.name} ${v}`,
			description: 'Managed volume, credentials and connection URL',
			icon: <DatabaseIcon className="size-4 text-chart-1" />,
			type: e.type,
			version: v,
			fields: [{ ...nameField, value: e.type === 'postgres' ? 'postgres' : e.type }]
		}))
	),
	...templates.map(t => ({
		id: `tpl-${t.id}`,
		group: 'Templates',
		label: t.name,
		description: t.description,
		icon: <LayoutTemplateIcon className="size-4 text-chart-5" />,
		type: 'docker-image' as const,
		fields: [{ ...nameField, value: t.id }]
	}))
];

const aiPlan = [
	{ name: 'app', type: 'github-repo' as const, note: 'Next.js · Nixpacks · :3000 · public domain', port: 3000 },
	{ name: 'worker', type: 'github-repo' as const, note: 'BullMQ worker · Dockerfile · no port' },
	{ name: 'db', type: 'postgres' as const, note: 'PostgreSQL 17 · 10Gi volume', port: 5432 },
	{ name: 'cache', type: 'docker-image' as const, note: 'redis:7.4-alpine', port: 6379 }
];

function uniqueName(name: string, existing: Service[]) {
	let n = name || 'service';
	let i = 2;
	while (existing.some(s => s.name === n)) n = `${name}-${i++}`;
	return n;
}

function makeService(p: Partial<Service> & { name: string; type: ServiceType; source: string }, existing: Service[]): Service {
	const name = uniqueName(p.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), existing);
	const db = ['postgres', 'mysql', 'mariadb', 'mongodb'].includes(p.type);
	return {
		id: `${name}-${Math.random().toString(36).slice(2, 6)}`,
		status: 'progressing',
		replicas: [0, 1],
		internalHost: `${name}.svc.cluster.local`,
		vars: [],
		position: { x: 0, y: 0 },
		lastDeploy: { status: 'pending', ago: 'just now' },
		...(db ? { volume: { name: `${name}-data`, mountPath: '/data', size: '10Gi', usedPct: 0 } } : {}),
		...p,
		name
	};
}

export function CreateServiceDialog({
	open,
	onOpenChange,
	existing,
	onCreate
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	existing: Service[];
	onCreate: (s: Service[]) => void;
}) {
	const [kind, setKind] = useState<Kind | 'ai' | null>(null);
	const [values, setValues] = useState<Record<string, string>>({});
	const [aiStep, setAiStep] = useState<'source' | 'analyzing' | 'plan'>('source');
	const [picked, setPicked] = useState(aiPlan.map(p => p.name));

	useEffect(() => {
		if (!open) {
			setKind(null);
			setAiStep('source');
			setPicked(aiPlan.map(p => p.name));
		}
	}, [open]);

	useEffect(() => {
		if (aiStep !== 'analyzing') return;
		const t = window.setTimeout(() => setAiStep('plan'), 1800);
		return () => window.clearTimeout(t);
	}, [aiStep]);

	const choose = (k: Kind | 'ai') => {
		setKind(k);
		setValues(
			k === 'ai' ? { repo: 'https://github.com/acme/saas-starter' } : Object.fromEntries(k.fields.map(f => [f.id, f.value ?? f.options?.[0] ?? '']))
		);
	};

	const submit = () => {
		if (!kind) return;
		if (kind === 'ai') {
			const created: Service[] = [];
			for (const p of aiPlan.filter(p => picked.includes(p.name))) {
				const vars =
					p.name === 'app'
						? [
								{ key: 'DATABASE_URL', value: '${{services.db.url}}' },
								{ key: 'REDIS_URL', value: 'redis://${{services.cache.host}}:6379' }
							]
						: p.name === 'worker'
							? [{ key: 'QUEUE_URL', value: 'redis://${{services.cache.host}}:6379/1' }]
							: [];
				created.push(
					makeService(
						{
							name: p.name,
							type: p.type,
							source: p.type === 'postgres' ? 'PostgreSQL 17' : p.type === 'docker-image' ? 'redis:7.4-alpine' : 'acme/saas-starter',
							branch: p.type === 'github-repo' ? 'main' : undefined,
							port: p.port,
							domain: p.name === 'app' ? 'saas-starter.apps.acme.dev' : undefined,
							vars
						},
						[...existing, ...created]
					)
				);
			}
			onCreate(created);
		} else if (kind.id === 'compose') {
			const text = values.compose ?? '';
			const names = [...text.matchAll(/^ {2}([\w-]+):\s*$/gm)].map(m => m[1]!);
			const images = [...text.matchAll(/^ {4}image:\s*(\S+)/gm)].map(m => m[1]!);
			const created: Service[] = [];
			names.forEach((n, i) =>
				created.push(
					makeService(
						{
							name: n,
							type: images[i]?.startsWith('postgres') ? 'postgres' : 'docker-image',
							source: images[i] ?? 'unknown',
							vars: n === 'app' ? [{ key: 'DATABASE_URL', value: 'postgres://app@${{services.db.host}}:5432/app' }] : []
						},
						[...existing, ...created]
					)
				)
			);
			onCreate(created);
		} else {
			const repo = values.repo ?? '';
			const fallback = repo.split('/').pop()?.split(':')[0]?.replace('.git', '') || kind.fields.find(f => f.id === 'name')?.value || 'service';
			onCreate([
				makeService(
					{
						name: values.name || fallback,
						type: kind.type,
						source: kind.version ? kind.label : kind.type === 'dockerfile' ? 'Built from Dockerfile' : repo || kind.label,
						branch: values.branch || undefined,
						port: kind.version
							? { postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 }[kind.type as 'postgres']
							: kind.type === 'docker-image'
								? 80
								: 3000
					},
					existing
				)
			]);
		}
		onOpenChange(false);
	};

	const groups = [...new Set(kinds.map(k => k.group))];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={kind !== null}>
				{kind === null ? (
					<Command className="rounded-none">
						<DialogHeader className="sr-only">
							<DialogTitle>Create service</DialogTitle>
							<DialogDescription>Pick what to deploy</DialogDescription>
						</DialogHeader>
						<CommandInput placeholder="What do you want to deploy?" className="h-12" />
						<CommandList className="max-h-[420px]">
							<CommandEmpty>Nothing matches.</CommandEmpty>
							<CommandGroup heading="Assistant">
								<CommandItem onSelect={() => choose('ai')} className="py-2.5">
									<SparklesIcon className="size-4 text-muted-foreground" />
									<div>
										<div className="font-medium">Analyze repository</div>
										<div className="text-xs text-muted-foreground">Propose services, databases and variables from a repo</div>
									</div>
								</CommandItem>
							</CommandGroup>
							{groups.map(g => (
								<CommandGroup key={g} heading={g}>
									{kinds
										.filter(k => k.group === g)
										.map(k => (
											<CommandItem key={k.id} value={`${k.label} ${k.group}`} onSelect={() => choose(k)} className="py-2">
												<span className="text-muted-foreground [&_svg]:size-4">{k.icon}</span>
												<div className="min-w-0">
													<div className="font-medium">{k.label}</div>
													<div className="truncate text-xs text-muted-foreground">{k.description}</div>
												</div>
											</CommandItem>
										))}
								</CommandGroup>
							))}
						</CommandList>
					</Command>
				) : (
					<>
						<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-4">
							<Button variant="ghost" size="icon-sm" onClick={() => setKind(null)} aria-label="Back">
								<ArrowLeftIcon />
							</Button>
							<div>
								<DialogTitle>{kind === 'ai' ? 'Analyze repository' : kind.label}</DialogTitle>
								<DialogDescription>{kind === 'ai' ? 'We read the repo and propose a setup you can review.' : kind.description}</DialogDescription>
							</div>
						</DialogHeader>
						<div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-5">
							{kind === 'ai' ? (
								<AiFlow step={aiStep} repo={values.repo ?? ''} onRepo={repo => setValues({ repo })} picked={picked} setPicked={setPicked} />
							) : (
								<>
									{kind.fields.map(f => (
										<div key={f.id} className="space-y-1.5">
											<Label htmlFor={`c-${f.id}`}>{f.label}</Label>
											{f.input === 'select' ? (
												<Select value={values[f.id]} onValueChange={v => setValues(x => ({ ...x, [f.id]: v }))}>
													<SelectTrigger id={`c-${f.id}`} className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{f.options!.map(o => (
															<SelectItem key={o} value={o}>
																{o}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											) : f.input === 'textarea' ? (
												<Textarea
													id={`c-${f.id}`}
													value={values[f.id]}
													onChange={e => setValues(x => ({ ...x, [f.id]: e.target.value }))}
													className="min-h-44 font-mono text-xs leading-5"
													spellCheck={false}
												/>
											) : (
												<Input
													id={`c-${f.id}`}
													value={values[f.id]}
													placeholder={f.id === 'name' ? 'derived from source' : f.placeholder}
													onChange={e => setValues(x => ({ ...x, [f.id]: e.target.value }))}
													className={f.mono ? 'font-mono text-sm' : undefined}
												/>
											)}
										</div>
									))}
									{kind.type.endsWith('repo') && (
										<div className="flex items-center justify-between rounded-md border px-3 py-2.5">
											<div>
												<Label htmlFor="c-auto">Auto-deploy on push</Label>
												<p className="text-xs text-muted-foreground">Deploy every commit to the branch.</p>
											</div>
											<Switch id="c-auto" defaultChecked />
										</div>
									)}
									{kind.type === 'docker-image' && kind.id === 'image' && (
										<div className="flex items-center justify-between rounded-md border px-3 py-2.5">
											<div>
												<Label htmlFor="c-watch">Watch for updates</Label>
												<p className="text-xs text-muted-foreground">Redeploy when the tag gets a new digest.</p>
											</div>
											<Switch id="c-watch" />
										</div>
									)}
								</>
							)}
						</div>
						<DialogFooter className="border-t bg-muted/40 px-5 py-3">
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							{kind === 'ai' && aiStep === 'source' ? (
								<Button onClick={() => setAiStep('analyzing')}>
									<SparklesIcon /> Analyze
								</Button>
							) : (
								<Button onClick={submit} disabled={kind === 'ai' && (aiStep !== 'plan' || picked.length === 0)}>
									{kind === 'ai' ? `Create ${picked.length} services` : kind.id === 'compose' ? 'Import services' : 'Create & deploy'}
								</Button>
							)}
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function AiFlow({
	step,
	repo,
	onRepo,
	picked,
	setPicked
}: {
	step: 'source' | 'analyzing' | 'plan';
	repo: string;
	onRepo: (r: string) => void;
	picked: string[];
	setPicked: (p: string[]) => void;
}) {
	if (step === 'source') {
		return (
			<div className="space-y-1.5">
				<Label htmlFor="ai-repo">Repository</Label>
				<Input id="ai-repo" value={repo} onChange={e => onRepo(e.target.value)} className="font-mono text-sm" />
				<p className="text-xs text-muted-foreground">Only the file tree and manifests are read. Nothing is deployed until you confirm.</p>
			</div>
		);
	}
	if (step === 'analyzing') {
		return (
			<div className="space-y-2 py-4">
				{['Cloning repository', 'Detecting frameworks and entrypoints', 'Planning services and variables'].map((l, i) => (
					<div
						key={l}
						className="flex animate-in items-center gap-2 text-sm fade-in"
						style={{ animationDelay: `${i * 400}ms`, animationFillMode: 'both' }}
					>
						<Loader2Icon className="size-4 animate-spin text-primary-text" />
						{l}
					</div>
				))}
			</div>
		);
	}
	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2 text-sm">
				<CheckIcon className="size-4 text-success" />
				Found a Next.js app, a queue worker and two backing services.
			</div>
			<div className="divide-y rounded-lg border">
				{aiPlan.map(p => (
					<Label key={p.name} htmlFor={`ai-${p.name}`} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal">
						<Checkbox
							id={`ai-${p.name}`}
							checked={picked.includes(p.name)}
							onCheckedChange={c => setPicked(c ? [...picked, p.name] : picked.filter(x => x !== p.name))}
						/>
						<span className="font-mono text-sm font-medium">{p.name}</span>
						<span className="text-xs text-muted-foreground">{p.note}</span>
					</Label>
				))}
			</div>
			<p className="text-xs text-muted-foreground">
				Variables like <code className="font-mono">DATABASE_URL</code> are wired to the new services automatically.
			</p>
		</div>
	);
}
