'use client';

import { ExternalLinkIcon, GitForkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsCard } from '@/components/settings-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GitHubIcon } from '@/features/service/service-icon';
import { cn } from '@/lib/utils';
import { useGiteaIntegration, useGithubIntegration } from './use-git-integrations';

function Availability({ connected }: { connected: boolean | undefined }) {
	if (connected === undefined) return null;
	return connected ? (
		<Badge variant="outline" className="border-success/30 bg-success/10 text-[11px] text-success">
			Available
		</Badge>
	) : (
		<Badge variant="secondary" className="text-[11px]">
			Not configured
		</Badge>
	);
}

function NotConfigured({ provider }: { provider: string }) {
	return (
		<p className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
			No {provider} is connected on this platform yet. Ask an administrator to connect one in{' '}
			<span className="font-medium text-foreground">platform settings → Integrations</span>.
		</p>
	);
}

function AccountRow({ login, kind, children }: { login: string; kind: string; children?: React.ReactNode }) {
	return (
		<li className="flex items-center gap-3 px-3 py-2.5">
			<span
				className={cn(
					'flex size-7 shrink-0 items-center justify-center bg-foreground text-xs font-semibold text-background',
					kind === 'User' ? 'rounded-full' : 'rounded-md'
				)}
			>
				{login[0]?.toUpperCase()}
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate font-mono text-sm font-medium">{login}</p>
				<p className="text-xs text-muted-foreground">{kind}</p>
			</div>
			{children}
		</li>
	);
}

export function GithubSection({ teamId, isOwner }: { teamId: string; isOwner: boolean }) {
	const { connection, installations } = useGithubIntegration(teamId);
	const connected = connection.data?.connected;
	const installUrl = connection.data?.installUrl;

	return (
		<SettingsCard
			title={
				<span className="flex items-center gap-2">
					<GitHubIcon className="size-4" />
					GitHub
					<Availability connected={connected} />
				</span>
			}
			description="Install the platform’s GitHub App on your repositories to deploy them as services, with push-to-deploy and PR previews."
			footer={
				connected &&
				(isOwner ? (
					<>
						<p className="mr-auto text-xs text-muted-foreground">Repository access is managed on GitHub.</p>
						<Button size="sm" variant="outline" disabled={!installUrl} onClick={() => installUrl && window.location.assign(installUrl)}>
							<GitHubIcon />
							Install / manage repositories
							<ExternalLinkIcon className="text-muted-foreground" />
						</Button>
					</>
				) : (
					<p className="mr-auto text-xs text-muted-foreground">Only team owners can install or change repository access.</p>
				))
			}
		>
			{connection.isPending || (connected && installations.isPending) ? (
				<Skeleton className="h-12 w-full" />
			) : !connected ? (
				<NotConfigured provider="GitHub App" />
			) : installations.data?.length ? (
				<ul className="divide-y rounded-md border">
					{installations.data.map(installation => (
						<AccountRow key={installation.id} login={installation.accountLogin} kind={installation.accountType}>
							{installation.suspended && (
								<Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">
									Suspended
								</Badge>
							)}
						</AccountRow>
					))}
				</ul>
			) : (
				<p className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
					No repositories installed yet. Install the App to pick which repositories this team can deploy.
				</p>
			)}
		</SettingsCard>
	);
}

export function GiteaSection({ teamId, isOwner }: { teamId: string; isOwner: boolean }) {
	const { connection, accounts, unbind } = useGiteaIntegration(teamId);
	const connected = connection.data?.connected;
	const authorizeUrl = connection.data?.authorizeUrl;

	const disconnect = (accountId: string) =>
		unbind.mutate(accountId, {
			onSuccess: () => toast.success('Gitea account disconnected'),
			onError: () => toast.error('Could not disconnect Gitea account')
		});

	return (
		<SettingsCard
			title={
				<span className="flex items-center gap-2">
					<GitForkIcon className="size-4" />
					Gitea
					<Availability connected={connected} />
				</span>
			}
			description="Authorize the platform’s Gitea OAuth app so this team can deploy repositories from your self-hosted Gitea."
			footer={
				connected &&
				(isOwner ? (
					<Button size="sm" disabled={!authorizeUrl} onClick={() => authorizeUrl && window.location.assign(authorizeUrl)}>
						Connect Gitea account
					</Button>
				) : (
					<p className="mr-auto text-xs text-muted-foreground">Only team owners can connect or change Gitea access.</p>
				))
			}
		>
			{connection.isPending || (connected && accounts.isPending) ? (
				<Skeleton className="h-12 w-full" />
			) : !connected ? (
				<NotConfigured provider="Gitea OAuth application" />
			) : accounts.data?.length ? (
				<ul className="divide-y rounded-md border">
					{accounts.data.map(account => (
						<AccountRow key={account.id} login={account.accountLogin} kind={account.accountType}>
							{isOwner && (
								<Button
									variant="ghost"
									size="xs"
									disabled={unbind.isPending && unbind.variables === account.id}
									onClick={() => disconnect(account.id)}
								>
									Disconnect
								</Button>
							)}
						</AccountRow>
					))}
				</ul>
			) : (
				<p className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
					No Gitea account connected yet. Authorize access to pick repositories this team can deploy.
				</p>
			)}
		</SettingsCard>
	);
}
