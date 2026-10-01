'use client';

import { useState } from 'react';
import { BanIcon, CopyIcon, Ellipsis, PauseIcon, PlayIcon, PlusIcon, ServerIcon, Trash2 } from 'lucide-react';
import { apiData, type BuildAgentDto, type BuildAgentRegistrationDto } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SettingsCard } from '@/components/settings-layout';
import { LoadError } from '@/components/settings/parts';
import { StatusDot } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const agentsApi = () => getBrowserApi().platform.buildAgents;

const STATUS: Record<BuildAgentDto['status'], { label: string; dot: string; text: string }> = {
	pending: { label: 'Awaiting registration', dot: 'bg-info animate-pulse', text: 'text-info' },
	online: { label: 'Online', dot: 'bg-success', text: 'text-success' },
	offline: { label: 'Offline', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
	paused: { label: 'Paused', dot: 'bg-warning', text: 'text-warning' },
	revoked: { label: 'Revoked', dot: 'bg-destructive', text: 'text-destructive' },
	incompatible: { label: 'Incompatible', dot: 'bg-destructive', text: 'text-destructive' },
	unavailable: { label: 'Unavailable', dot: 'bg-warning', text: 'text-warning' }
};

const CONFIRM_TEXT = {
	revoke: 'Revoke this server? Its active builds fail and its credentials stop working.',
	remove: 'Remove this server? It must be registered again to reconnect.'
};

function AgentStatus({ status }: { status: BuildAgentDto['status'] }) {
	const style = STATUS[status];
	return (
		<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', style.text)}>
			<StatusDot className={cn('size-1.5', style.dot)} />
			{style.label}
		</span>
	);
}

function agentFacts(agent: BuildAgentDto) {
	return [
		agent.architecture,
		agent.cpus !== null && `${agent.cpus} CPUs`,
		agent.memoryBytes !== null && `${formatBytes(agent.memoryBytes)} RAM`,
		agent.freeDiskBytes !== null && `${formatBytes(agent.freeDiskBytes)} free disk`,
		agent.version && `v${agent.version.replace(/^v/, '')}`,
		agent.lastSeenAt && `seen ${formatRelative(agent.lastSeenAt)}`
	].filter(Boolean);
}

function BuildServer({ agent, refresh }: { agent: BuildAgentDto; refresh: () => void }) {
	const [capacity, setCapacity] = useState(String(agent.maxConcurrentBuilds));
	const [confirm, setConfirm] = useState<'revoke' | 'remove' | null>(null);
	const action = useMutation({
		mutationFn: async (kind: 'pause' | 'capacity' | 'revoke' | 'remove') => {
			if (kind === 'revoke') return apiData(agentsApi()(agent.id).revoke.post());
			if (kind === 'remove') return apiData(agentsApi()(agent.id).delete());
			return apiData(
				agentsApi()(agent.id).put({
					paused: kind === 'pause' ? !agent.paused : agent.paused,
					maxConcurrentBuilds: kind === 'capacity' ? Number(capacity) : agent.maxConcurrentBuilds
				})
			);
		},
		onSuccess: () => {
			setConfirm(null);
			refresh();
		},
		onError: () => toast.error('Could not update build server', { description: 'Stop active builds before removing a server.' })
	});
	const validCapacity = Number.isInteger(Number(capacity)) && Number(capacity) >= 1 && Number(capacity) <= 32;
	const capacityChanged = Number(capacity) !== agent.maxConcurrentBuilds;
	const revoked = agent.status === 'revoked';
	const facts = agentFacts(agent);
	return (
		<li className="space-y-3 py-4 first:pt-0 last:pb-0">
			<div className="flex items-start gap-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
					<ServerIcon className="size-4 text-muted-foreground" />
				</div>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span className="truncate font-medium">{agent.name}</span>
						<AgentStatus status={agent.status} />
					</div>
					{facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p>}
				</div>
				{!revoked && (
					<div className="flex shrink-0 items-center gap-2">
						<span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{agent.activeBuilds} /</span>
						<Input
							aria-label={`Parallel builds for ${agent.name}`}
							title="Parallel builds"
							className="h-8 w-16 tabular-nums"
							type="number"
							min={1}
							max={32}
							value={capacity}
							onChange={event => setCapacity(event.target.value)}
							aria-invalid={!validCapacity}
						/>
						{capacityChanged && (
							<Button size="sm" disabled={action.isPending || !validCapacity} onClick={() => action.mutate('capacity')}>
								Save
							</Button>
						)}
					</div>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${agent.name}`} disabled={action.isPending}>
							<Ellipsis className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{!revoked && (
							<>
								<DropdownMenuItem onSelect={() => action.mutate('pause')}>
									{agent.paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
									{agent.paused ? 'Resume' : 'Pause'}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => setConfirm('revoke')}>
									<BanIcon className="size-4" />
									Revoke access
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						<DropdownMenuItem variant="destructive" disabled={agent.activeBuilds > 0} onSelect={() => setConfirm('remove')}>
							<Trash2 className="size-4" />
							Remove server
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{confirm && (
				<div className="ml-12 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
					<p className="text-sm">{CONFIRM_TEXT[confirm]}</p>
					<div className="flex gap-2">
						<Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
							Cancel
						</Button>
						<Button size="sm" variant="destructive" disabled={action.isPending} onClick={() => action.mutate(confirm)}>
							{confirm === 'revoke' ? 'Revoke' : 'Remove'}
						</Button>
					</div>
				</div>
			)}
		</li>
	);
}

function Registration({ registration, onDismiss }: { registration: BuildAgentRegistrationDto; onDismiss: () => void }) {
	const copy = () =>
		void navigator.clipboard.writeText(registration.installCommand).then(
			() => toast.success('Command copied'),
			() => toast.error('Could not copy command')
		);
	return (
		<div className="mt-5 space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
			<div className="space-y-1">
				<p className="text-sm font-medium">Install the agent</p>
				<p className="text-sm text-muted-foreground">
					Run this on a dedicated Linux server with Docker. It needs access to your Git repositories and image registry. Expires{' '}
					{formatDateTime(registration.expiresAt)}.
				</p>
			</div>
			<div className="relative">
				<pre className="overflow-x-auto rounded-md border bg-background p-3 pr-12 font-mono text-xs whitespace-pre-wrap break-all">
					{registration.installCommand}
				</pre>
				<Button variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5" aria-label="Copy command" onClick={copy}>
					<CopyIcon className="size-4" />
				</Button>
			</div>
			<div className="flex justify-end">
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					Done
				</Button>
			</div>
		</div>
	);
}

export function BuildServers() {
	const client = useQueryClient();
	const [name, setName] = useState('');
	const [registration, setRegistration] = useState<BuildAgentRegistrationDto | null>(null);
	const query = useQuery({ queryKey: queryKeys.buildAgents, queryFn: () => apiData(agentsApi().get()), refetchInterval: 10_000 });
	const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.buildAgents });
	const create = useMutation({
		mutationFn: () => apiData(agentsApi().post({ name: name.trim(), maxConcurrentBuilds: 1 })),
		onSuccess: data => {
			setRegistration(data);
			setName('');
			refresh();
		},
		onError: () => toast.error('Could not register build server')
	});
	return (
		<SettingsCard
			title="External build servers"
			description="Agents run the complete build on your Linux servers and connect to kubwave over HTTPS. The number next to each server sets its parallel builds."
			footer={
				<form
					className="flex w-full gap-2 sm:w-auto"
					onSubmit={event => {
						event.preventDefault();
						create.mutate();
					}}
				>
					<Input
						aria-label="Server name"
						className="h-8 sm:w-56"
						value={name}
						maxLength={80}
						placeholder="build-01"
						onChange={event => setName(event.target.value)}
					/>
					<Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
						<PlusIcon className="size-4" />
						Add server
					</Button>
				</form>
			}
		>
			{query.isError ? (
				<LoadError what="the build servers" onRetry={() => void query.refetch()} />
			) : query.data?.length === 0 ? (
				<div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center">
					<ServerIcon className="mb-1 size-5 text-muted-foreground" />
					<p className="text-sm font-medium">No build servers yet</p>
					<p className="text-sm text-muted-foreground">Add a server below to get an install command.</p>
				</div>
			) : (
				<ul className="divide-y">
					{query.data?.map(agent => (
						<BuildServer key={agent.id} agent={agent} refresh={refresh} />
					))}
				</ul>
			)}
			{registration && <Registration registration={registration} onDismiss={() => setRegistration(null)} />}
		</SettingsCard>
	);
}
