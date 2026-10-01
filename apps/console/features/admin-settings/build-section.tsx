'use client';

import { BoxesIcon, ServerIcon } from 'lucide-react';
import { Choice, Field, Row, Suffixed } from '@/components/admin/form';
import { SettingsCard } from '@/components/settings-layout';
import { LoadError } from '@/components/settings/parts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import type { useBuildSettings } from './use-build-settings';
import { BuildServers } from './build-servers';

type BuildGroup = ReturnType<typeof useBuildSettings>;
type QuantityKey = 'cpuRequest' | 'cpuLimit' | 'memoryRequest' | 'memoryLimit';

const RESOURCES = [
	{ label: 'CPU', request: 'cpuRequest', limit: 'cpuLimit', requestHint: 'Optional', limitHint: 'Unlimited', example: '500m or 2' },
	{ label: 'Memory', request: 'memoryRequest', limit: 'memoryLimit', requestHint: '1.5Gi', limitHint: '2Gi', example: '512Mi or 4Gi' }
] as const;

export function BuildSection({ group }: { group: BuildGroup }) {
	if (group.failed) return <LoadError what="the build settings" onRetry={group.retry} />;
	if (!group.loaded) return <Skeleton className="h-64 rounded-lg" />;
	const external = group.draft.execution === 'agent';
	return (
		<>
			<ExecutionCard group={group} />
			{external && <BuildServers />}
			<ClusterResourcesCard group={group} />
			{!external && <BuildServers />}
		</>
	);
}

function ExecutionCard({ group }: { group: BuildGroup }) {
	return (
		<SettingsCard title="Build execution" description="Where new service images are built. Running and queued builds keep their saved settings.">
			<div className="space-y-5">
				<RadioGroup
					value={group.draft.execution}
					onValueChange={value => group.set({ execution: value as 'cluster' | 'agent' })}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Choice value="cluster" icon={BoxesIcon} title="In Kubernetes" description="Build jobs run as pods on this cluster." />
					<Choice
						value="agent"
						icon={ServerIcon}
						title="External build servers"
						description="Agents on your own Linux servers build and push images."
					/>
				</RadioGroup>
				<div className="grid gap-4 sm:grid-cols-2">
					<TimeoutField group={group} name="timeoutSeconds" label="Build timeout" hint="Counted from when the build starts." />
					<TimeoutField group={group} name="queueTimeoutSeconds" label="Queue timeout" hint="Maximum wait for free capacity." />
				</div>
				{group.draft.execution === 'agent' && (
					<div className="border-t pt-5">
						<Row
							label="Fall back to Kubernetes"
							htmlFor="build-fallback"
							description="Unstarted builds use the cluster after 90 seconds without external capacity. Running external builds are never duplicated."
						>
							<Switch
								id="build-fallback"
								checked={group.draft.fallbackToCluster}
								onCheckedChange={fallbackToCluster => group.set({ fallbackToCluster })}
							/>
						</Row>
					</div>
				)}
			</div>
		</SettingsCard>
	);
}

function TimeoutField({
	group,
	name,
	label,
	hint
}: {
	group: BuildGroup;
	name: 'timeoutSeconds' | 'queueTimeoutSeconds';
	label: string;
	hint: string;
}) {
	return (
		<Field label={label} htmlFor={`build-${name}`} hint={hint} error={group.errors[name]}>
			<Suffixed
				id={`build-${name}`}
				suffix="sec"
				value={group.draft[name]}
				onChange={event => group.set({ [name]: event.target.value })}
				aria-invalid={Boolean(group.errors[name])}
			/>
		</Field>
	);
}

function ClusterResourcesCard({ group }: { group: BuildGroup }) {
	const unused = group.draft.execution === 'agent' && !group.draft.fallbackToCluster;
	return (
		<SettingsCard
			title="Kubernetes build resources"
			description={
				unused
					? 'Not used while builds run on external servers without fallback.'
					: 'Requests reserve scheduling capacity, limits cap usage. Applies to checkout, Nixpacks and image builds.'
			}
		>
			<div className="divide-y">
				{RESOURCES.map(resource => (
					<ResourceRow key={resource.label} group={group} resource={resource} />
				))}
				<Row
					label="Concurrent cluster builds"
					htmlFor="build-maxConcurrentBuilds"
					description={
						group.errors.maxConcurrentBuilds ? (
							<span className="text-destructive">{group.errors.maxConcurrentBuilds}</span>
						) : (
							'Further builds wait for a free slot.'
						)
					}
				>
					<Input
						id="build-maxConcurrentBuilds"
						type="number"
						min={1}
						max={100}
						value={group.draft.maxConcurrentBuilds}
						onChange={event => group.set({ maxConcurrentBuilds: event.target.value })}
						aria-invalid={Boolean(group.errors.maxConcurrentBuilds)}
						className="w-24 tabular-nums"
					/>
				</Row>
			</div>
		</SettingsCard>
	);
}

function ResourceRow({ group, resource }: { group: BuildGroup; resource: (typeof RESOURCES)[number] }) {
	const error = group.errors[resource.request] ?? group.errors[resource.limit];
	return (
		<div className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="space-y-0.5">
				<Label htmlFor={`build-${resource.request}`}>{resource.label}</Label>
				<p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{error ?? `For example ${resource.example}.`}</p>
			</div>
			<div className="grid shrink-0 grid-cols-2 gap-2 sm:w-72">
				<QuantityInput group={group} name={resource.request} resource={resource.label} caption="Request" placeholder={resource.requestHint} />
				<QuantityInput group={group} name={resource.limit} resource={resource.label} caption="Limit" placeholder={resource.limitHint} />
			</div>
		</div>
	);
}

function QuantityInput({
	group,
	name,
	resource,
	caption,
	placeholder
}: {
	group: BuildGroup;
	name: QuantityKey;
	resource: string;
	caption: string;
	placeholder: string;
}) {
	return (
		<div className="space-y-1">
			<Input
				id={`build-${name}`}
				aria-label={`${resource} ${caption.toLowerCase()}`}
				placeholder={placeholder}
				className="font-mono"
				value={group.draft[name]}
				onChange={event => group.set({ [name]: event.target.value })}
				aria-invalid={Boolean(group.errors[name])}
			/>
			<span className="block text-xs text-muted-foreground">{caption}</span>
		</div>
	);
}
