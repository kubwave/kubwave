'use client';

import {
	CircleArrowUpIcon,
	CircleCheckIcon,
	CircleXIcon,
	ExternalLinkIcon,
	GaugeIcon,
	NetworkIcon,
	PlugIcon,
	RefreshCwIcon,
	RocketIcon,
	ServerCogIcon,
	Undo2Icon
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { fmt, InfoStrip, Meter } from '@/components/admin/cluster-ui';
import { Field, numberError, Row } from '@/components/admin/form';
import { IntegrationsSection, type RegistryStatus } from '@/components/admin/settings-integrations';
import { UpdateDialog } from '@/components/admin/update-dialog';
import { PageHeader } from '@/components/page-header';
import { ListCard, useHashSection } from '@/components/settings/parts';
import { SaveBar, useDraft } from '@/components/settings/save-bar';
import { SettingsCard, SettingsLayout } from '@/components/settings-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { currentUser } from '@/lib/mock';
import {
	cluster,
	networkSettings,
	platform,
	platformSettings,
	releases,
	tcpAllocations,
	updateHistory,
	volumes,
	type UpdateRun
} from '@/lib/mock-admin';
import { cn } from '@/lib/utils';

const sectionIds = ['system', 'scaling', 'network', 'integrations'];
const scalingKeys = ['ha', 'maxDeploys', 'previewLimit', 'autoscale', 'asThreshold', 'asGrowth', 'asMax'] as const;
const registryKeys = ['registryMode', 'registryUrl', 'registryUser', 'registryPassword'] as const;
const changelog = (v: string) => `https://github.com/kubwave/kubwave/releases/tag/${v}`;

const runStatus: Record<UpdateRun['status'], { icon: React.ComponentType<{ className?: string }>; label: string; className: string }> = {
	succeeded: { icon: CircleCheckIcon, label: 'Succeeded', className: 'text-success' },
	failed: { icon: CircleXIcon, label: 'Failed', className: 'text-destructive' },
	rolled_back: { icon: Undo2Icon, label: 'Rolled back', className: 'text-warning' }
};

const unsavedDot = (n: number) => (n ? <span className="size-1.5 rounded-full bg-warning" aria-label={`${n} unsaved`} /> : undefined);

function Suffixed({ suffix, ...props }: React.ComponentProps<typeof Input> & { suffix: string }) {
	return (
		<div className="relative">
			<Input inputMode="numeric" className="pr-12 tabular-nums" {...props} />
			<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
		</div>
	);
}

export default function PlatformSettingsPage() {
	const [section, setSection] = useHashSection(sectionIds);
	const form = useDraft(platformSettings);
	const net = useDraft(networkSettings);
	const d = form.draft;
	const n = net.draft;

	const [installed, setInstalled] = useState(platform.installed);
	const [history, setHistory] = useState(updateHistory);
	const [lastChecked, setLastChecked] = useState(platform.lastChecked);
	const [checking, setChecking] = useState(false);
	const [registryApply, setRegistryApply] = useState<Exclude<RegistryStatus, 'pending'>>('applied');

	const updateAvailable = installed !== platform.latest;
	const latest = releases.find(r => r.version === platform.latest)!;
	const dirtyCount = (keys: readonly (keyof typeof d)[]) => keys.filter(k => d[k] !== form.saved[k]).length;
	const scalingDirty = dirtyCount(scalingKeys);
	const registryStatus: RegistryStatus = dirtyCount(registryKeys) ? 'pending' : registryApply;

	const errors = {
		maxDeploys: numberError(d.maxDeploys, 1, 20),
		previewLimit: numberError(d.previewLimit, 0, 50),
		asThreshold: d.autoscale ? numberError(d.asThreshold, 50, 95) : null,
		asGrowth: d.autoscale ? numberError(d.asGrowth, 5, 100) : null,
		asMax: d.autoscale ? numberError(d.asMax, 1, 2000) : null
	};
	const tcpErrors = {
		start: n.tcp ? numberError(n.tcpStart, 1024, 65535) : null,
		end: n.tcp
			? (numberError(n.tcpEnd, 1024, 65535) ?? (Number(n.tcpEnd) <= Number(n.tcpStart) ? 'Must be greater than the start port.' : null))
			: null
	};
	const invalid = [...Object.values(errors), ...Object.values(tcpErrors)].filter(Boolean).length;
	const portCount = Math.max(0, Number(n.tcpEnd) - Number(n.tcpStart) + 1);

	const saveAll = () => {
		if (invalid) {
			toast.error(`Fix ${invalid} invalid field${invalid === 1 ? '' : 's'} before saving`);
			return;
		}
		const total = form.changes + net.changes;
		if (dirtyCount(registryKeys)) {
			setRegistryApply('applying');
			const ok = d.registryMode === 'platform' || d.registryUrl.includes('.');
			setTimeout(() => setRegistryApply(ok ? 'applied' : 'failed'), 2500);
		}
		form.save();
		net.save();
		toast.success('Platform settings saved', { description: `${total} change${total === 1 ? '' : 's'} applied.` });
	};

	const applyNetwork = () => {
		net.save();
		toast.success('Network settings applied', {
			description: n.tcp ? `Port pool ${n.tcpStart}–${n.tcpEnd} is active. Traefik is rolling out.` : 'TCP port pool disabled.'
		});
	};

	const checkNow = () => {
		setChecking(true);
		setTimeout(() => {
			setChecking(false);
			setLastChecked('Just now');
			toast(updateAvailable ? `kubwave ${platform.latest} is available` : 'You are on the latest version');
		}, 1200);
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-8">
			<PageHeader title="Platform settings" description="Instance-wide configuration. Changes apply to every team on this cluster." />

			<SettingsLayout
				active={section}
				onChange={setSection}
				sections={[
					{
						id: 'system',
						label: 'System',
						icon: ServerCogIcon,
						badge: updateAvailable ? (
							<span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary-text">{platform.latest}</span>
						) : undefined
					},
					{ id: 'scaling', label: 'Scaling & storage', icon: GaugeIcon, badge: unsavedDot(scalingDirty) },
					{ id: 'network', label: 'Network', icon: NetworkIcon, badge: unsavedDot(net.changes) },
					{ id: 'integrations', label: 'Integrations', icon: PlugIcon, badge: unsavedDot(form.changes - scalingDirty) }
				]}
			>
				{section === 'system' && (
					<>
						<section className="overflow-hidden rounded-lg border bg-card">
							<div className="flex flex-wrap items-start gap-4 p-5">
								<div className="min-w-0 flex-1 space-y-1">
									<h2 className="flex items-center gap-2 text-base font-semibold">
										{updateAvailable ? <CircleArrowUpIcon className="size-4 text-info" /> : <CircleCheckIcon className="size-4 text-success" />}
										{updateAvailable ? (
											<>
												Update available: <span className="font-mono">{platform.latest}</span>
											</>
										) : (
											'kubwave is up to date'
										)}
									</h2>
									<p className="text-sm text-muted-foreground">
										{updateAvailable ? `${latest.summary} Released ${latest.date}.` : `You're running the latest stable release, ${installed}.`}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Button variant="outline" size="sm" asChild>
										<a href={changelog(platform.latest)} target="_blank" rel="noreferrer">
											Changelog
											<ExternalLinkIcon />
										</a>
									</Button>
									{updateAvailable && (
										<UpdateDialog
											from={installed}
											to={platform.latest}
											onComplete={() => {
												setHistory(h => [
													{
														id: `h${h.length + 1}`,
														from: installed,
														to: platform.latest,
														status: 'succeeded',
														started: 'Sep 28, 2026 14:31',
														duration: '2m 36s',
														by: currentUser.name
													},
													...h
												]);
												setInstalled(platform.latest);
												toast.success(`kubwave ${platform.latest} installed`);
											}}
										>
											<Button size="sm">
												<RocketIcon />
												Update now
											</Button>
										</UpdateDialog>
									)}
								</div>
							</div>
							<dl className="grid grid-cols-3 divide-x border-t">
								<div className="space-y-0.5 px-5 py-3">
									<dt className="text-xs text-muted-foreground">Installed</dt>
									<dd className="font-mono text-sm">{installed}</dd>
								</div>
								<div className="space-y-0.5 px-5 py-3">
									<dt className="text-xs text-muted-foreground">Latest</dt>
									<dd className="font-mono text-sm">{platform.latest}</dd>
								</div>
								<div className="space-y-0.5 px-5 py-3">
									<dt className="text-xs text-muted-foreground">Last checked</dt>
									<dd className="flex items-center gap-1 text-sm">
										{checking ? 'Checking…' : lastChecked}
										<Button variant="ghost" size="icon-xs" aria-label="Check for updates" disabled={checking} onClick={checkNow}>
											<RefreshCwIcon className={cn(checking && 'animate-spin')} />
										</Button>
									</dd>
								</div>
							</dl>
						</section>

						<InfoStrip
							items={[
								{ label: 'API uptime', value: <span className="tabular-nums">{platform.apiUptime}</span>, hint: 'kubwave-api · 2 replicas' },
								{ label: 'Node runtime', value: <span className="font-mono">{platform.nodeRuntime}</span>, hint: 'API and worker' },
								{ label: 'Kubernetes', value: <span className="font-mono">{cluster.k8sVersion}</span>, hint: `${cluster.name}` },
								{ label: 'Helm chart', value: <span className="font-mono">kubwave-{installed}</span>, hint: 'namespace kubwave' }
							]}
						/>

						<ListCard title="Available releases" description="Stable channel from ghcr.io/kubwave. Prereleases are hidden.">
							{releases.map(r => (
								<li key={r.version} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3">
									<div className="flex w-40 shrink-0 items-center gap-2">
										<span className="font-mono text-sm font-medium">{r.version}</span>
										{r.version === platform.latest && (
											<Badge variant="outline" className="border-primary/30 text-primary-text">
												Latest
											</Badge>
										)}
										{r.version === installed && <Badge variant="secondary">Current</Badge>}
									</div>
									<p className="min-w-0 flex-1 text-sm text-muted-foreground">{r.summary}</p>
									<span className="text-xs text-muted-foreground">{r.date}</span>
									<a
										href={changelog(r.version)}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
										aria-label={`Changelog for ${r.version}`}
									>
										Changelog
										<ExternalLinkIcon className="size-3" />
									</a>
								</li>
							))}
						</ListCard>

						<SettingsCard title="Update history" description="Every upgrade runs as an atomic Helm release and rolls back on failure.">
							<div className="-mx-5 -mb-5 border-t">
								<Table>
									<TableHeader>
										<TableRow className="hover:bg-transparent">
											<TableHead className="pl-5">Version</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Started</TableHead>
											<TableHead className="text-right">Duration</TableHead>
											<TableHead className="pr-5">By</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{history.map(h => {
											const s = runStatus[h.status];
											return (
												<TableRow key={h.id}>
													<TableCell className="pl-5 font-mono text-xs">
														<span className="text-muted-foreground">{h.from}</span> → {h.to}
													</TableCell>
													<TableCell>
														<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.className)}>
															<s.icon className="size-3.5" />
															{s.label}
														</span>
													</TableCell>
													<TableCell className="text-muted-foreground">{h.started}</TableCell>
													<TableCell className="text-right font-mono text-xs">{h.duration}</TableCell>
													<TableCell className="pr-5 text-muted-foreground">{h.by}</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						</SettingsCard>
					</>
				)}

				{section === 'scaling' && (
					<>
						<SettingsCard title="Scaling" description="Control plane replicas and deployment throughput.">
							<div className="divide-y">
								<Row
									label="High availability"
									htmlFor="ha"
									description="Run API, console and worker with 2 replicas and PodDisruptionBudgets. Needs 2+ schedulable nodes."
								>
									<Switch id="ha" checked={d.ha} onCheckedChange={x => form.set('ha', x)} />
								</Row>
								<Row
									label="Max concurrent deployments"
									htmlFor="max-deploys"
									description={
										errors.maxDeploys ? (
											<span className="text-destructive">{errors.maxDeploys}</span>
										) : (
											'Builds and rollouts beyond this are queued. 1 to 20.'
										)
									}
								>
									<Input
										id="max-deploys"
										type="number"
										min={1}
										max={20}
										value={d.maxDeploys}
										onChange={e => form.set('maxDeploys', e.target.value)}
										aria-invalid={!!errors.maxDeploys}
										className="w-24 tabular-nums"
									/>
								</Row>
								<Row
									label="PR previews per project"
									htmlFor="preview-limit"
									description={
										errors.previewLimit ? (
											<span className="text-destructive">{errors.previewLimit}</span>
										) : (
											'Oldest previews are removed when the limit is reached. 0 disables previews.'
										)
									}
								>
									<Input
										id="preview-limit"
										type="number"
										min={0}
										max={50}
										value={d.previewLimit}
										onChange={e => form.set('previewLimit', e.target.value)}
										aria-invalid={!!errors.previewLimit}
										className="w-24 tabular-nums"
									/>
								</Row>
							</div>
						</SettingsCard>

						<SettingsCard
							title="Storage"
							description={
								<>
									Persistent volumes across all projects.
									{d.autoscale && (
										<span className="ml-2 inline-flex items-center gap-1.5 text-xs">
											<span className="h-2.5 w-0.5 rounded-full bg-foreground" aria-hidden /> autoscale threshold
										</span>
									)}
								</>
							}
						>
							<ul className="space-y-4">
								{volumes.map(vol => (
									<li
										key={vol.name}
										className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)_120px]"
									>
										<div className="min-w-0">
											<div className="truncate font-mono text-sm">{vol.name}</div>
											<div className="text-xs text-muted-foreground">{vol.owner}</div>
										</div>
										<Meter
											value={vol.used}
											max={vol.size}
											requested={d.autoscale && !errors.asThreshold ? (vol.size * Number(d.asThreshold)) / 100 : undefined}
											className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"
										/>
										<div className="text-right text-xs text-muted-foreground tabular-nums">
											<span className="text-foreground">{fmt(vol.used)}</span> / {vol.size} GiB · {Math.round((vol.used / vol.size) * 100)}%
										</div>
									</li>
								))}
							</ul>
						</SettingsCard>

						<SettingsCard title="Volume autoscaling" description="Grow volumes before they fill up. Needs a storage class with allowVolumeExpansion.">
							<div className="space-y-5">
								<Row label="Enable volume autoscaling" htmlFor="autoscale">
									<Switch id="autoscale" checked={d.autoscale} onCheckedChange={x => form.set('autoscale', x)} />
								</Row>
								<div className="grid gap-4 sm:grid-cols-3">
									<Field label="Threshold" htmlFor="as-threshold" error={errors.asThreshold} hint="Usage that triggers growth">
										<Suffixed
											id="as-threshold"
											suffix="%"
											disabled={!d.autoscale}
											value={d.asThreshold}
											onChange={e => form.set('asThreshold', e.target.value)}
											aria-invalid={!!errors.asThreshold}
										/>
									</Field>
									<Field label="Growth" htmlFor="as-growth" error={errors.asGrowth} hint="Added per expansion">
										<Suffixed
											id="as-growth"
											suffix="%"
											disabled={!d.autoscale}
											value={d.asGrowth}
											onChange={e => form.set('asGrowth', e.target.value)}
											aria-invalid={!!errors.asGrowth}
										/>
									</Field>
									<Field label="Max size" htmlFor="as-max" error={errors.asMax} hint="Per volume ceiling">
										<Suffixed
											id="as-max"
											suffix="GiB"
											disabled={!d.autoscale}
											value={d.asMax}
											onChange={e => form.set('asMax', e.target.value)}
											aria-invalid={!!errors.asMax}
										/>
									</Field>
								</div>
								<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
									{d.autoscale ? (
										<>
											When a volume passes <span className="font-medium text-foreground">{d.asThreshold}%</span>, it grows by{' '}
											<span className="font-medium text-foreground">{d.asGrowth}%</span>, up to{' '}
											<span className="font-medium text-foreground">{d.asMax} GiB</span>.
										</>
									) : (
										'Volumes keep their size until resized manually.'
									)}
								</p>
							</div>
						</SettingsCard>
					</>
				)}

				{section === 'network' && (
					<SettingsCard
						title="Public TCP port pool"
						description="NodePorts handed out to services that expose raw TCP, such as databases."
						footer={
							<>
								<span className="mr-auto text-xs text-muted-foreground">Applying reconfigures Traefik entrypoints and rolls its pods.</span>
								<Button size="sm" disabled={!net.changes || !!tcpErrors.start || !!tcpErrors.end} onClick={applyNetwork}>
									Apply network settings
								</Button>
							</>
						}
					>
						<div className="space-y-5">
							<Row label="Enable TCP port pool" htmlFor="tcp" description="Disabling keeps allocated ports until services are redeployed.">
								<Switch id="tcp" checked={n.tcp} onCheckedChange={x => net.set('tcp', x)} />
							</Row>
							<div className="grid gap-4 sm:grid-cols-2">
								<Field label="Range start" htmlFor="tcp-start" error={tcpErrors.start}>
									<Input
										id="tcp-start"
										inputMode="numeric"
										disabled={!n.tcp}
										value={n.tcpStart}
										onChange={e => net.set('tcpStart', e.target.value)}
										aria-invalid={!!tcpErrors.start}
										className="font-mono"
									/>
								</Field>
								<Field label="Range end" htmlFor="tcp-end" error={tcpErrors.end}>
									<Input
										id="tcp-end"
										inputMode="numeric"
										disabled={!n.tcp}
										value={n.tcpEnd}
										onChange={e => net.set('tcpEnd', e.target.value)}
										aria-invalid={!!tcpErrors.end}
										className="font-mono"
									/>
								</Field>
							</div>
							{n.tcp && (
								<div className="space-y-2">
									<div className="text-xs text-muted-foreground tabular-nums">
										{portCount} ports in pool · {tcpAllocations.length} allocated
									</div>
									<ul className="flex flex-wrap gap-1.5">
										{tcpAllocations.map(a => (
											<li key={a.port} className="rounded-md border bg-muted/50 px-2 py-1 text-xs">
												<span className="font-mono">{a.port}</span> <span className="text-muted-foreground">→ {a.target}</span>
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					</SettingsCard>
				)}

				{section === 'integrations' && <IntegrationsSection values={d} set={form.set} registryStatus={registryStatus} />}
			</SettingsLayout>

			<SaveBar
				changes={form.changes + net.changes}
				onDiscard={() => {
					form.discard();
					net.discard();
				}}
				onSave={saveAll}
			/>
		</div>
	);
}
