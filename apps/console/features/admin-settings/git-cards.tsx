'use client';

import { ExternalLinkIcon, GitForkIcon, LoaderCircleIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Field, SecretInput } from '@/components/admin/form';
import { useConfirm } from '@/components/confirm-provider';
import { CopyField } from '@/components/settings/parts';
import { SettingsCard } from '@/components/settings-layout';
import { StatusDot } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GitHubIcon } from '@/features/service/service-icon';
import { formatRelative } from '@/lib/format';
import { giteaErrorMessage } from './model';
import { useGiteaConnection, useGithubConnection } from './use-git-connections';

function Connected({ since }: { since: string | null }) {
	return (
		<span className="inline-flex items-center gap-1 text-xs text-success">
			<StatusDot className="size-1.5 bg-success" />
			Connected{since && <span className="text-muted-foreground"> · {formatRelative(since)}</span>}
		</span>
	);
}

export function GithubCard() {
	const { connection, connect, disconnect } = useGithubConnection();
	const confirm = useConfirm();
	const github = connection.data;

	const onDisconnect = async () => {
		const confirmed = await confirm({
			title: 'Disconnect GitHub App',
			description: 'Teams can no longer deploy private GitHub repositories or auto-deploy on push until an app is connected again.',
			confirmLabel: 'Disconnect',
			destructive: true
		});
		if (confirmed) disconnect.mutate();
	};

	return (
		<SettingsCard title="GitHub App" description="Deploy private GitHub repositories and auto-deploy on push.">
			{github?.connected ? (
				<div className="flex flex-wrap items-center gap-4">
					<span className="flex size-10 items-center justify-center rounded-lg border bg-muted">
						<GitHubIcon className="size-5" />
					</span>
					<div className="min-w-0 flex-1 space-y-0.5">
						<div className="flex items-center gap-2 text-sm font-medium">
							<span className="font-mono">{github.appSlug}</span>
							<Connected since={github.connectedAt} />
						</div>
						<div className="text-xs text-muted-foreground">Teams install it on their repositories from team settings.</div>
					</div>
					{github.installUrl && (
						<Button variant="outline" size="sm" asChild>
							<a href={github.installUrl} target="_blank" rel="noopener noreferrer">
								Install / manage repositories
								<ExternalLinkIcon />
							</a>
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="text-destructive hover:text-destructive"
						disabled={disconnect.isPending}
						onClick={() => void onDisconnect()}
					>
						Disconnect
					</Button>
				</div>
			) : (
				<div className="flex flex-wrap items-center justify-between gap-4">
					<p className="max-w-lg text-sm text-muted-foreground">
						Creates a GitHub App on your account or organization. You&apos;ll review its permissions on GitHub, then come back here.
					</p>
					<Button size="sm" disabled={connect.isPending || connection.isPending} onClick={() => connect.mutate()}>
						{connect.isPending ? <LoaderCircleIcon className="animate-spin" /> : <GitHubIcon className="size-4" />}
						Create GitHub App
					</Button>
				</div>
			)}
		</SettingsCard>
	);
}

const noSubscription = () => () => {};

export function GiteaCard() {
	const { connection, connect, disconnect } = useGiteaConnection();
	const confirm = useConfirm();
	const [form, setForm] = useState({ instanceUrl: '', clientId: '', clientSecret: '' });
	// Same-origin fallback so the redirect URI shows before the connection loads; null during SSR to hydrate cleanly.
	const origin = useSyncExternalStore(
		noSubscription,
		() => window.location.origin,
		() => null
	);
	const gitea = connection.data;
	const callbackUrl = gitea?.callbackUrl ?? (origin && `${origin}/api/git/gitea/callback`);
	const webhookUrl = gitea?.webhookUrl ?? (origin && `${origin}/api/git/gitea/webhook`);
	const complete = Boolean(form.instanceUrl.trim() && form.clientId.trim() && form.clientSecret.trim());

	const onDisconnect = async () => {
		const confirmed = await confirm({
			title: 'Disconnect Gitea',
			description: 'Teams can no longer deploy Gitea repositories without SSH keys until Gitea is connected again.',
			confirmLabel: 'Disconnect',
			destructive: true
		});
		if (confirmed) disconnect.mutate();
	};

	return (
		<SettingsCard
			title={
				<span className="flex items-center gap-2">
					<GitForkIcon className="size-4 text-muted-foreground" />
					Gitea
				</span>
			}
			description="OAuth application on a self-hosted Gitea or Forgejo, so teams can deploy repositories without SSH keys."
		>
			<div className="space-y-5">
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<div className="text-sm font-medium">Redirect URI</div>
						{callbackUrl ? <CopyField value={callbackUrl} label="Redirect URI" /> : <Input disabled value="Loading…" aria-label="Redirect URI" />}
						<p className="text-xs text-muted-foreground">Register this exact URL on the Gitea OAuth2 application (Settings → Applications).</p>
					</div>
					{webhookUrl && (
						<div className="space-y-2">
							<div className="text-sm font-medium">Webhook URL (optional)</div>
							<CopyField value={webhookUrl} label="Webhook URL" />
							<p className="text-xs text-muted-foreground">Add it as a repository webhook for instant auto-deploy.</p>
						</div>
					)}
				</div>

				{gitea?.connected ? (
					<div className="flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3">
						<div className="min-w-0 flex-1 space-y-1 text-sm">
							<div className="flex items-center gap-2">
								<span className="truncate font-mono">{gitea.instanceUrl}</span>
								<Connected since={gitea.connectedAt} />
							</div>
							<div className="text-xs text-muted-foreground">
								Client ID <span className="font-mono text-foreground">{gitea.clientId}</span>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive"
							disabled={disconnect.isPending}
							onClick={() => void onDisconnect()}
						>
							Disconnect
						</Button>
					</div>
				) : (
					<form
						className="grid gap-4 sm:grid-cols-2"
						onSubmit={event => {
							event.preventDefault();
							if (complete && !connect.isPending)
								connect.mutate({ instanceUrl: form.instanceUrl.trim(), clientId: form.clientId.trim(), clientSecret: form.clientSecret.trim() });
						}}
					>
						<Field label="Instance URL" htmlFor="gitea-url" className="sm:col-span-2">
							<Input
								id="gitea-url"
								value={form.instanceUrl}
								onChange={event => setForm({ ...form, instanceUrl: event.target.value })}
								className="font-mono"
								placeholder="https://gitea.example.com"
								autoComplete="off"
							/>
						</Field>
						<Field label="Client ID" htmlFor="gitea-client">
							<Input
								id="gitea-client"
								value={form.clientId}
								onChange={event => setForm({ ...form, clientId: event.target.value })}
								className="font-mono"
								autoComplete="off"
							/>
						</Field>
						<Field label="Client secret" htmlFor="gitea-secret">
							<SecretInput id="gitea-secret" value={form.clientSecret} onChange={clientSecret => setForm({ ...form, clientSecret })} />
						</Field>
						{connect.isError && <p className="text-sm text-destructive sm:col-span-2">{giteaErrorMessage(connect.error)}</p>}
						<div className="sm:col-span-2">
							<Button type="submit" size="sm" disabled={connect.isPending || !complete}>
								{connect.isPending && <LoaderCircleIcon className="animate-spin" />}
								Connect Gitea
							</Button>
						</div>
					</form>
				)}
			</div>
		</SettingsCard>
	);
}
