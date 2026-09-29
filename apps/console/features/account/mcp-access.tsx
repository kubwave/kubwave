'use client';

import type { McpAccessDto } from '@kubwave/api-client';
import { BotIcon, KeyRoundIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-provider';
import { SettingsCard } from '@/components/settings-layout';
import { CodeBlock, CopyField, EmptyRow, ListCard, LoadError, RowIcon } from '@/components/settings/parts';
import { StatusDot } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTeams } from '@/features/team/use-teams';
import { cn } from '@/lib/utils';
import { AccountLayout } from './account-layout';
import { CreateTokenDialog, ScopeChips } from './create-token-dialog';
import { type AccessStatus, accessStatus, accessSummary } from './mcp-model';
import { useMcpAccess, useMcpInfo } from './use-mcp-access';

const oauthSteps = [
	'Add the endpoint as a remote HTTP MCP server in your client.',
	'Sign in and approve the requested scopes in the browser window that opens.',
	'The client appears under connected clients below. Revoke it any time.'
];

const statusBadge: Record<AccessStatus, React.ReactNode> = {
	active: (
		<span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
			<StatusDot className="size-1.5 bg-success" />
			Active
		</span>
	),
	expired: (
		<Badge variant="secondary" className="px-1.5 text-[10px]">
			Expired
		</Badge>
	),
	revoked: (
		<Badge variant="outline" className="border-destructive/30 px-1.5 text-[10px] text-destructive">
			Revoked
		</Badge>
	)
};

export function McpAccessSettings() {
	const info = useMcpInfo();
	const endpoint = info.data?.endpoint;
	return (
		<AccountLayout active="mcp">
			<SettingsCard
				title="Connect with OAuth"
				description="OAuth-capable clients like Claude Code only need the endpoint URL. They open a browser window where you approve the requested scopes — no token to copy around."
			>
				<div className="space-y-4">
					{endpoint ? <CopyField value={endpoint} label="MCP endpoint" /> : <Skeleton className="h-9 w-full" />}
					<ol className="grid gap-2 sm:grid-cols-3">
						{oauthSteps.map((step, i) => (
							<li key={step} className="flex gap-2.5 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
								<span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px] text-foreground">
									{i + 1}
								</span>
								{step}
							</li>
						))}
					</ol>
					{endpoint && <CodeBlock value={`claude mcp add --transport http kubwave ${endpoint}`} label="Copy command" />}
				</div>
			</SettingsCard>

			<SettingsCard
				title="Create personal token"
				description="For clients without OAuth, or for scripts and CI. A token acts as you, limited to the scopes and team you choose."
			>
				<div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center">
					<RowIcon icon={KeyRoundIcon} className="bg-background" />
					<p className="flex-1 text-xs text-muted-foreground">
						Send it as <code className="font-mono text-foreground">Authorization: Bearer kw_…</code>. It is shown once and expires after 7, 30 or 90
						days.
					</p>
					<CreateTokenDialog />
				</div>
			</SettingsCard>

			<AccessList />
		</AccountLayout>
	);
}

function AccessList() {
	const confirm = useConfirm();
	const { teams } = useTeams();
	const { entries, revoke } = useMcpAccess();
	const list = entries.data ?? [];
	const active = list.filter(entry => accessStatus(entry) === 'active').length;

	const onRevoke = async (entry: McpAccessDto) => {
		const confirmed = await confirm({
			title: 'Revoke access',
			description: `Revoke “${entry.name}”? Clients using it lose access immediately. This cannot be undone.`,
			confirmLabel: 'Revoke',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await revoke.mutateAsync(entry.id);
			toast.success('Access revoked', { description: `${entry.name} can no longer use kubwave.` });
		} catch {
			toast.error('Could not revoke access', { description: 'Please try again.' });
		}
	};

	return (
		<ListCard title="Connected clients and tokens" description={`${active} active · revoke anything you no longer use.`}>
			{entries.isPending &&
				[0, 1].map(i => (
					<li key={i} className="flex items-center gap-3 px-5 py-3.5">
						<Skeleton className="size-5 rounded-md" />
						<div className="grid flex-1 gap-1.5">
							<Skeleton className="h-3.5 w-32" />
							<Skeleton className="h-3 w-64" />
						</div>
					</li>
				))}
			{entries.isError && (
				<li>
					<LoadError what="your AI access" onRetry={() => void entries.refetch()} />
				</li>
			)}
			{entries.isSuccess && list.length === 0 && (
				<EmptyRow icon={BotIcon} title="No AI access yet" description="Connect an OAuth-capable client or create a personal token." />
			)}
			{list.map(entry => {
				const status = accessStatus(entry);
				const inactive = status !== 'active';
				return (
					<li key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
						<RowIcon icon={entry.kind === 'oauth' ? BotIcon : KeyRoundIcon} className={cn(inactive && 'opacity-50')} />
						<div className={cn('min-w-0 flex-1 space-y-1.5', inactive && 'opacity-60')}>
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm font-medium">{entry.name}</span>
								<Badge variant="outline" className="px-1.5 text-[10px]">
									{entry.kind === 'oauth' ? 'OAuth' : 'Personal token'}
								</Badge>
								{statusBadge[status]}
							</div>
							<div className="flex flex-wrap gap-1">
								<ScopeChips scopes={entry.scopes} />
							</div>
							<p className="text-xs text-muted-foreground" suppressHydrationWarning>
								{accessSummary(entry, teams)}
							</p>
						</div>
						{!inactive && (
							<Button
								variant="ghost"
								size="sm"
								disabled={revoke.isPending && revoke.variables === entry.id}
								className="text-muted-foreground hover:text-destructive"
								onClick={() => void onRevoke(entry)}
							>
								Revoke
							</Button>
						)}
					</li>
				);
			})}
		</ListCard>
	);
}
