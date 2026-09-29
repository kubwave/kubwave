'use client';

import type { RegistrySettingsDto } from '@kubwave/api-client';
import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, GlobeIcon, LoaderCircleIcon } from 'lucide-react';
import { Choice, Field, Row, SecretInput } from '@/components/admin/form';
import { SettingsCard } from '@/components/settings-layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { LoadError } from '@/components/settings/parts';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { RegistryFields } from '@/features/platform/registry-fields';
import { cn } from '@/lib/utils';
import { EmailCard } from './email-card';
import { GiteaCard, GithubCard } from './git-cards';
import { domainPreview } from './model';
import type { IntegrationGroups } from './use-settings-tabs';

const JUMPS = [
	['int-domain', 'App domain'],
	['int-registry', 'Build registry'],
	['int-github', 'GitHub'],
	['int-gitea', 'Gitea'],
	['int-smtp', 'Email'],
	['int-metrics', 'Metrics'],
	['int-ai', 'AI assistant']
] as const;

export function IntegrationsSection({ groups }: { groups: IntegrationGroups }) {
	const failed = Object.values(groups).filter(group => group.failed);
	if (failed.length > 0)
		return <LoadError what="the integration settings" onRetry={() => failed.forEach(group => group.retry())} className="rounded-lg border" />;
	if (!Object.values(groups).every(group => group.loaded))
		return (
			<>
				<Skeleton className="h-8 w-2/3 rounded-full" />
				<Skeleton className="h-64 rounded-lg" />
				<Skeleton className="h-64 rounded-lg" />
			</>
		);

	return (
		<>
			<nav aria-label="Integrations" className="flex flex-wrap gap-1.5">
				{JUMPS.map(([id, name]) => (
					<button
						key={id}
						type="button"
						onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
						className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						{name}
					</button>
				))}
			</nav>
			<div id="int-domain" className="scroll-mt-28">
				<DomainCard group={groups.domain} />
			</div>
			<div id="int-registry" className="scroll-mt-28">
				<RegistryCard group={groups.registry} />
			</div>
			<div id="int-github" className="scroll-mt-28">
				<GithubCard />
			</div>
			<div id="int-gitea" className="scroll-mt-28">
				<GiteaCard />
			</div>
			<div id="int-smtp" className="scroll-mt-28">
				<EmailCard group={groups.smtp} />
			</div>
			<div id="int-metrics" className="scroll-mt-28">
				<MetricsCard group={groups.metrics} />
			</div>
			<div id="int-ai" className="scroll-mt-28">
				<AiCard group={groups.ai} />
			</div>
		</>
	);
}

function DomainCard({ group }: { group: IntegrationGroups['domain'] }) {
	const { draft, errors, set, source } = group;
	const sslipBase = source?.mode === 'sslip' ? source.effectiveBase : null;
	const previewBase = draft.mode === 'sslip' ? sslipBase : draft.base.trim() || 'apps.mycloud.com';

	return (
		<SettingsCard
			title="App domain"
			description="Every service with an HTTP port gets a generated public URL, unless you add a custom domain, which then takes over."
		>
			<div className="space-y-5">
				<RadioGroup
					value={draft.mode}
					onValueChange={mode => set({ mode: mode as typeof draft.mode })}
					className="sm:grid-cols-3"
					aria-label="App domain mode"
				>
					<Choice value="sslip" title="sslip.io (automatic)" description="A working URL derived from the cluster ingress IP. No DNS setup." />
					<Choice
						value="wildcard"
						title="Wildcard base domain"
						description="Your own domain. Point *.<base> at the cluster ingress for nicer hosts and TLS."
					/>
					<Choice value="off" title="Off" description="Services only get the custom domains you add manually." />
				</RadioGroup>
				{draft.mode === 'off' ? (
					<p className="text-sm text-muted-foreground">New services won&apos;t get a public hostname until you add a custom domain.</p>
				) : (
					<div className="grid gap-4 sm:grid-cols-2">
						{draft.mode === 'wildcard' && (
							<Field
								label="Base domain"
								htmlFor="domain-base"
								error={errors.base}
								hint={
									<>
										Create a wildcard DNS A record <span className="font-mono">*.{draft.base.trim() || 'apps.mycloud.com'}</span> pointing at the
										cluster ingress IP.
									</>
								}
							>
								<Input
									id="domain-base"
									value={draft.base}
									onChange={event => set({ base: event.target.value })}
									aria-invalid={Boolean(errors.base)}
									className="font-mono"
									placeholder="apps.mycloud.com"
								/>
							</Field>
						)}
						<Field
							label="Subdomain template (optional)"
							htmlFor="domain-template"
							hint={
								<>
									Tokens: <span className="font-mono">{'{name}'}</span> <span className="font-mono">{'{shortId}'}</span>
								</>
							}
						>
							<Input
								id="domain-template"
								value={draft.subdomainTemplate}
								onChange={event => set({ subdomainTemplate: event.target.value })}
								className="font-mono"
								placeholder="{name}-{shortId}"
							/>
						</Field>
						<div className="space-y-2 sm:col-span-2">
							<div className="text-xs text-muted-foreground">Preview · a service named my-service</div>
							{previewBase ? (
								<div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
									<GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="text-muted-foreground">https://</span>
									<span className="truncate">{domainPreview(draft.subdomainTemplate, previewBase)}</span>
								</div>
							) : (
								<p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
									Waiting for the cluster ingress IP. Services get a sslip.io URL once the ingress load balancer is ready.
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		</SettingsCard>
	);
}

const REGISTRY_STATUS: Record<
	RegistrySettingsDto['applyStatus'],
	{ icon: React.ComponentType<{ className?: string }>; label: string; className: string }
> = {
	applied: { icon: CircleCheckIcon, label: 'Applied', className: 'text-success' },
	pending: { icon: CircleDashedIcon, label: 'Pending', className: 'text-muted-foreground' },
	applying: { icon: LoaderCircleIcon, label: 'Applying', className: 'text-info [&>svg]:animate-spin' },
	failed: { icon: CircleXIcon, label: 'Failed', className: 'text-destructive' },
	not_configured: { icon: CircleDashedIcon, label: 'Not configured', className: 'text-muted-foreground' }
};

function RegistryCard({ group }: { group: IntegrationGroups['registry'] }) {
	const applyStatus = group.source?.applyStatus ?? 'not_configured';
	const status = REGISTRY_STATUS[applyStatus];
	return (
		<SettingsCard
			title={
				<span className="flex items-center gap-2">
					Build registry
					<span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', status.className)}>
						<status.icon className="size-3" />
						{status.label}
					</span>
				</span>
			}
			description="Image destination for Dockerfile, public-repo and private-repo builds."
		>
			<div className="space-y-5">
				<RegistryFields draft={group.draft} errors={group.errors} hasStoredPassword={group.source?.hasPassword ?? false} onChange={group.set} />
				{(applyStatus === 'pending' || applyStatus === 'applying') && (
					<p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">Registry changes are being applied by the worker.</p>
				)}
				{applyStatus === 'failed' && (
					<Alert variant="destructive">
						<CircleXIcon />
						<AlertTitle>Registry apply failed</AlertTitle>
						{group.source?.lastError && (
							<AlertDescription>
								<span className="font-mono text-xs break-all">{group.source.lastError}</span>
							</AlertDescription>
						)}
					</Alert>
				)}
			</div>
		</SettingsCard>
	);
}

function MetricsCard({ group }: { group: IntegrationGroups['metrics'] }) {
	const { draft, errors, set } = group;
	return (
		<SettingsCard title="Service metrics" description="Where the per-service Metrics tab gets CPU, memory, network and disk data from.">
			<div className="space-y-4">
				<RadioGroup
					value={draft.provider}
					onValueChange={provider => set({ provider: provider as typeof draft.provider })}
					className="sm:grid-cols-3"
					aria-label="Metrics source"
				>
					<Choice value="live" title="Live only" description="Current usage from the kubelet. No history, no extra infrastructure." />
					<Choice value="prometheus-external" title="External Prometheus" description="Historical charts from a Prometheus you already run." />
					<Choice value="prometheus-managed" title="Managed Prometheus" description="The platform deploys and runs Prometheus in-cluster." />
				</RadioGroup>
				{draft.provider === 'prometheus-external' && (
					<Field label="Prometheus URL" htmlFor="prom-url" error={errors.prometheusUrl} hint="Base URL of the Prometheus HTTP API, no trailing path.">
						<Input
							id="prom-url"
							value={draft.prometheusUrl}
							onChange={event => set({ prometheusUrl: event.target.value })}
							aria-invalid={Boolean(errors.prometheusUrl)}
							className="font-mono"
							placeholder="http://prometheus.monitoring.svc:9090"
						/>
					</Field>
				)}
			</div>
		</SettingsCard>
	);
}

function AiCard({ group }: { group: IntegrationGroups['ai'] }) {
	const { draft, errors, set, source } = group;
	const anthropic = draft.provider === 'anthropic';
	return (
		<SettingsCard
			title="AI assistant"
			description="Analyzes a repository and proposes services, env vars and databases. The model sees the file tree, manifests, Dockerfiles and env templates, never real .env files."
		>
			<div className="space-y-5">
				<Row
					label="Enable repository analysis"
					htmlFor="ai-enabled"
					description="Point the endpoint at an in-cluster model to keep code inside your infrastructure."
				>
					<Switch id="ai-enabled" checked={draft.enabled} onCheckedChange={enabled => set({ enabled })} />
				</Row>
				<RadioGroup
					value={draft.provider}
					onValueChange={provider => set({ provider: provider as typeof draft.provider })}
					className="sm:grid-cols-2"
					aria-label="AI provider"
				>
					<Choice value="anthropic" title="Anthropic" description="Claude models through the Anthropic API or a compatible gateway." />
					<Choice
						value="openai-compatible"
						title="OpenAI-compatible"
						description="Any /v1/chat/completions endpoint: OpenAI, OpenRouter, LiteLLM, or a local Ollama or vLLM."
					/>
				</RadioGroup>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field
						label="Base URL"
						htmlFor="ai-base-url"
						error={errors.baseUrl}
						hint={anthropic ? 'Optional. Leave empty for the Anthropic API.' : 'Required.'}
					>
						<Input
							id="ai-base-url"
							value={draft.baseUrl}
							onChange={event => set({ baseUrl: event.target.value })}
							aria-invalid={Boolean(errors.baseUrl)}
							className="font-mono"
							placeholder={anthropic ? 'https://api.anthropic.com/v1' : 'http://ollama.ollama.svc:11434/v1'}
						/>
					</Field>
					<Field
						label="Model"
						htmlFor="ai-model"
						error={errors.model}
						hint={
							<>
								Model id with an optional <span className="font-mono">:effort</span> suffix (minimal, low, medium, high, xhigh, max).
							</>
						}
					>
						<Input
							id="ai-model"
							value={draft.model}
							onChange={event => set({ model: event.target.value })}
							aria-invalid={Boolean(errors.model)}
							className="font-mono"
							placeholder={anthropic ? 'claude-opus-5:high' : 'gpt-5:medium'}
						/>
					</Field>
					<Field
						label="API key"
						htmlFor="ai-key"
						hint="Stored encrypted. Local endpoints such as Ollama usually need none."
						className="sm:col-span-2"
					>
						<SecretInput
							id="ai-key"
							value={draft.apiKey}
							onChange={apiKey => set({ apiKey })}
							placeholder={source?.hasApiKey ? '•••••••• stored, leave empty to keep' : undefined}
						/>
					</Field>
				</div>
			</div>
		</SettingsCard>
	);
}
