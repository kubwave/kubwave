'use client';

import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, ExternalLinkIcon, GlobeIcon, LoaderCircleIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Choice, Field, SecretInput } from '@/components/admin/form';
import { GitHubIcon } from '@/components/service/service-icon';
import { CopyField } from '@/components/settings/parts';
import { SettingsCard } from '@/components/settings-layout';
import { StatusDot } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currentUser } from '@/lib/mock';
import { appUrl, clusterIp, type PlatformSettings } from '@/lib/mock-admin';
import { cn } from '@/lib/utils';

export type RegistryStatus = 'applied' | 'pending' | 'applying' | 'failed';

const registryBadge: Record<RegistryStatus, { icon: React.ComponentType<{ className?: string }>; label: string; className: string }> = {
	applied: { icon: CircleCheckIcon, label: 'Applied', className: 'text-success' },
	pending: { icon: CircleDashedIcon, label: 'Pending', className: 'text-muted-foreground' },
	applying: { icon: LoaderCircleIcon, label: 'Applying', className: 'text-info [&>svg]:animate-spin' },
	failed: { icon: CircleXIcon, label: 'Failed', className: 'text-destructive' }
};

const jump = [
	['int-domain', 'App domain'],
	['int-registry', 'Build registry'],
	['int-github', 'GitHub'],
	['int-gitea', 'Gitea'],
	['int-smtp', 'Email'],
	['int-metrics', 'Metrics'],
	['int-ai', 'AI assistant']
] as const;

type Setter = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => void;

export function IntegrationsSection({ values: v, set, registryStatus }: { values: PlatformSettings; set: Setter; registryStatus: RegistryStatus }) {
	const [github, setGithub] = useState(true);
	const rb = registryBadge[registryStatus];
	const label = v.domainPattern
		.replaceAll('{service}', 'web')
		.replaceAll('{project}', 'storefront')
		.replaceAll('{env}', 'production')
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-');
	const host = `${label || 'web'}.${v.domainMode === 'sslip' ? `${clusterIp.replaceAll('.', '-')}.sslip.io` : v.domainBase || 'example.com'}`;

	return (
		<>
			<nav aria-label="Integrations" className="flex flex-wrap gap-1.5">
				{jump.map(([id, name]) => (
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
				<SettingsCard title="App domain" description="Generated hostnames for services without a custom domain.">
					<div className="space-y-5">
						<RadioGroup value={v.domainMode} onValueChange={x => set('domainMode', x)} className="sm:grid-cols-3" aria-label="App domain mode">
							<Choice value="sslip" title="sslip.io" description="Zero config. Resolves straight to the cluster IP." />
							<Choice value="wildcard" title="Wildcard base domain" description="Point a wildcard DNS record at the cluster." />
							<Choice value="off" title="Off" description="Services only get custom domains." />
						</RadioGroup>
						{v.domainMode !== 'off' ? (
							<div className="grid gap-4 sm:grid-cols-2">
								{v.domainMode === 'wildcard' && (
									<Field
										label="Base domain"
										htmlFor="domain-base"
										hint={
											<>
												DNS: <span className="font-mono">*.{v.domainBase || 'example.com'}</span> → A <span className="font-mono">{clusterIp}</span>
											</>
										}
									>
										<Input
											id="domain-base"
											value={v.domainBase}
											onChange={e => set('domainBase', e.target.value)}
											className="font-mono"
											placeholder="apps.example.com"
										/>
									</Field>
								)}
								<Field
									label="Name pattern"
									htmlFor="domain-pattern"
									hint={
										<>
											Tokens: <span className="font-mono">{'{service}'}</span> <span className="font-mono">{'{project}'}</span>{' '}
											<span className="font-mono">{'{env}'}</span>
										</>
									}
								>
									<Input id="domain-pattern" value={v.domainPattern} onChange={e => set('domainPattern', e.target.value)} className="font-mono" />
								</Field>
								<div className="space-y-2 sm:col-span-2">
									<div className="text-xs text-muted-foreground">Preview · web in storefront / production</div>
									<div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
										<GlobeIcon className="size-3.5 text-muted-foreground" />
										<span className="text-muted-foreground">https://</span>
										<span className="truncate">{host}</span>
									</div>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">New services won&apos;t get a public hostname until you add a custom domain.</p>
						)}
					</div>
				</SettingsCard>
			</div>

			<div id="int-registry" className="scroll-mt-28">
				<SettingsCard
					title={
						<span className="flex items-center gap-2">
							Build registry
							<span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', rb.className)}>
								<rb.icon className="size-3" />
								{rb.label}
							</span>
						</span>
					}
					description="Where images built from source are pushed and pulled from."
				>
					<div className="space-y-5">
						<RadioGroup value={v.registryMode} onValueChange={x => set('registryMode', x)} className="sm:grid-cols-2" aria-label="Registry mode">
							<Choice value="platform" title="Platform-managed" description="In-cluster registry on a 50 GiB volume, garbage-collected nightly." />
							<Choice value="external" title="External" description="GHCR, Docker Hub, Harbor or any OCI registry." />
						</RadioGroup>
						{v.registryMode === 'external' && (
							<div className="grid gap-4 sm:grid-cols-2">
								<Field label="Registry URL" htmlFor="reg-url" className="sm:col-span-2">
									<Input
										id="reg-url"
										value={v.registryUrl}
										onChange={e => set('registryUrl', e.target.value)}
										placeholder="ghcr.io/acme"
										className="font-mono"
									/>
								</Field>
								<Field label="Username" htmlFor="reg-user">
									<Input id="reg-user" value={v.registryUser} onChange={e => set('registryUser', e.target.value)} autoComplete="off" />
								</Field>
								<Field label="Password or token" htmlFor="reg-pass">
									<SecretInput id="reg-pass" value={v.registryPassword} onChange={x => set('registryPassword', x)} />
								</Field>
							</div>
						)}
						{registryStatus === 'failed' && (
							<Alert variant="destructive">
								<CircleXIcon />
								<AlertTitle>Registry unreachable</AlertTitle>
								<AlertDescription>
									<span className="font-mono text-xs">dial tcp: lookup {v.registryUrl || '(empty)'}: no such host</span>
								</AlertDescription>
							</Alert>
						)}
					</div>
				</SettingsCard>
			</div>

			<div id="int-github" className="scroll-mt-28">
				<SettingsCard title="GitHub App" description="Deploy from GitHub repositories and build PR previews.">
					{github ? (
						<div className="flex flex-wrap items-center gap-4">
							<span className="flex size-10 items-center justify-center rounded-lg border bg-muted">
								<GitHubIcon className="size-5" />
							</span>
							<div className="min-w-0 flex-1 space-y-0.5">
								<div className="flex items-center gap-2 text-sm font-medium">
									<span className="font-mono">kubwave-acme</span>
									<span className="inline-flex items-center gap-1 text-xs text-success">
										<StatusDot className="size-1.5 bg-success" />
										Connected
									</span>
								</div>
								<div className="text-xs text-muted-foreground">2 installations · acme, acme-labs · created Mar 2, 2025</div>
							</div>
							<Button variant="outline" size="sm" asChild>
								<a href="https://github.com/settings/apps/kubwave-acme" target="_blank" rel="noreferrer">
									Manage on GitHub
									<ExternalLinkIcon />
								</a>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive hover:text-destructive"
								onClick={() => {
									setGithub(false);
									toast.success('GitHub App disconnected', { description: 'Existing services keep their last deployed image.' });
								}}
							>
								Disconnect
							</Button>
						</div>
					) : (
						<div className="flex flex-wrap items-center justify-between gap-4">
							<p className="text-sm text-muted-foreground">
								No GitHub App connected. kubwave creates one for your account or organization via the manifest flow.
							</p>
							<Button
								size="sm"
								onClick={() => {
									setGithub(true);
									toast.success('GitHub App connected');
								}}
							>
								<GitHubIcon className="size-4" />
								Create GitHub App
							</Button>
						</div>
					)}
				</SettingsCard>
			</div>

			<div id="int-gitea" className="scroll-mt-28">
				<SettingsCard title="Gitea" description="OAuth application for a self-hosted Gitea or Forgejo instance.">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Instance URL" htmlFor="gitea-url" className="sm:col-span-2">
							<Input
								id="gitea-url"
								value={v.giteaUrl}
								onChange={e => set('giteaUrl', e.target.value)}
								className="font-mono"
								placeholder="https://gitea.example.com"
							/>
						</Field>
						<Field label="Client ID" htmlFor="gitea-client">
							<Input id="gitea-client" value={v.giteaClientId} onChange={e => set('giteaClientId', e.target.value)} className="font-mono" />
						</Field>
						<Field label="Client secret" htmlFor="gitea-secret" hint="Leave blank to keep the stored secret.">
							<SecretInput id="gitea-secret" value={v.giteaSecret} onChange={x => set('giteaSecret', x)} placeholder="•••••••••••• stored" />
						</Field>
						<div className="space-y-2">
							<div className="text-sm font-medium">Redirect URI</div>
							<CopyField value={`${appUrl}/api/integrations/gitea/callback`} label="Redirect URI" />
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Webhook URL</div>
							<CopyField value={`${appUrl}/api/webhooks/gitea`} label="Webhook URL" />
						</div>
					</div>
				</SettingsCard>
			</div>

			<div id="int-smtp" className="scroll-mt-28">
				<SettingsCard
					title="Email (SMTP)"
					description="Used for invitations, password resets and deployment notifications."
					footer={
						<Button
							variant="outline"
							size="sm"
							onClick={() => toast.success(`Test email sent to ${currentUser.email}`, { description: `via ${v.smtpHost}:${v.smtpPort}` })}
						>
							<SendIcon />
							Send test email
						</Button>
					}
				>
					<div className="grid gap-4 sm:grid-cols-6">
						<Field label="Host" htmlFor="smtp-host" className="sm:col-span-3">
							<Input id="smtp-host" value={v.smtpHost} onChange={e => set('smtpHost', e.target.value)} className="font-mono" />
						</Field>
						<Field label="Port" htmlFor="smtp-port" className="sm:col-span-1">
							<Input id="smtp-port" inputMode="numeric" value={v.smtpPort} onChange={e => set('smtpPort', e.target.value)} className="font-mono" />
						</Field>
						<Field label="Encryption" htmlFor="smtp-tls" className="sm:col-span-2">
							<Select value={v.smtpTls} onValueChange={x => set('smtpTls', x)}>
								<SelectTrigger id="smtp-tls" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="starttls">STARTTLS</SelectItem>
									<SelectItem value="tls">Implicit TLS</SelectItem>
									<SelectItem value="none">None</SelectItem>
								</SelectContent>
							</Select>
						</Field>
						<Field label="Username" htmlFor="smtp-user" className="sm:col-span-3">
							<Input id="smtp-user" value={v.smtpUser} onChange={e => set('smtpUser', e.target.value)} autoComplete="off" />
						</Field>
						<Field label="Password" htmlFor="smtp-pass" className="sm:col-span-3">
							<SecretInput id="smtp-pass" value={v.smtpPassword} onChange={x => set('smtpPassword', x)} placeholder="•••••••••••• stored" />
						</Field>
						<Field label="From name" htmlFor="smtp-from-name" className="sm:col-span-3">
							<Input id="smtp-from-name" value={v.smtpFromName} onChange={e => set('smtpFromName', e.target.value)} />
						</Field>
						<Field label="From address" htmlFor="smtp-from" className="sm:col-span-3">
							<Input id="smtp-from" type="email" value={v.smtpFrom} onChange={e => set('smtpFrom', e.target.value)} />
						</Field>
					</div>
				</SettingsCard>
			</div>

			<div id="int-metrics" className="scroll-mt-28">
				<SettingsCard title="Service metrics" description="Source for CPU, memory and network charts on services.">
					<div className="space-y-4">
						<RadioGroup value={v.metricsMode} onValueChange={x => set('metricsMode', x)} className="sm:grid-cols-3" aria-label="Metrics source">
							<Choice value="live" title="Live only" description="metrics-server snapshots, no history." />
							<Choice value="external" title="External Prometheus" description="Query a Prometheus you already run." />
							<Choice value="managed" title="Managed Prometheus" description="kubwave runs Prometheus with 15 days retention." />
						</RadioGroup>
						{v.metricsMode === 'external' && (
							<Field label="Prometheus URL" htmlFor="prom-url">
								<Input
									id="prom-url"
									value={v.prometheusUrl}
									onChange={e => set('prometheusUrl', e.target.value)}
									className="font-mono"
									placeholder="http://prometheus.monitoring.svc:9090"
								/>
							</Field>
						)}
						{v.metricsMode === 'managed' && (
							<p className="flex items-center gap-2 text-xs text-muted-foreground">
								<StatusDot className="size-1.5 bg-success" />
								Running · <span className="font-mono">prometheus-0</span> · 8.2 of 20 GiB used
							</p>
						)}
					</div>
				</SettingsCard>
			</div>

			<div id="int-ai" className="scroll-mt-28">
				<SettingsCard title="AI assistant" description="Powers the console assistant and explanations for failed deployments.">
					<div className="grid gap-4 sm:grid-cols-2">
						<RadioGroup
							value={v.aiProvider}
							onValueChange={x => set('aiProvider', x)}
							className="sm:col-span-2 sm:grid-cols-2"
							aria-label="AI provider"
						>
							<Choice value="anthropic" title="Anthropic" description="Claude models via the Anthropic API." />
							<Choice value="openai" title="OpenAI-compatible" description="OpenAI, Azure, vLLM, Ollama or any compatible endpoint." />
						</RadioGroup>
						<Field label="Model" htmlFor="ai-model">
							<Input id="ai-model" value={v.aiModel} onChange={e => set('aiModel', e.target.value)} className="font-mono" />
						</Field>
						<Field label="API key" htmlFor="ai-key" hint="Encrypted at rest. Leave blank to keep the stored key.">
							<SecretInput
								id="ai-key"
								value={v.aiKey}
								onChange={x => set('aiKey', x)}
								placeholder={v.aiProvider === 'anthropic' ? 'sk-ant-…4f2a' : 'sk-…'}
							/>
						</Field>
						{v.aiProvider === 'openai' && (
							<Field label="Endpoint" htmlFor="ai-endpoint" className="sm:col-span-2">
								<Input
									id="ai-endpoint"
									value={v.aiEndpoint}
									onChange={e => set('aiEndpoint', e.target.value)}
									className="font-mono"
									placeholder="https://api.openai.com/v1"
								/>
							</Field>
						)}
					</div>
				</SettingsCard>
			</div>
		</>
	);
}
