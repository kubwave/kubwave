'use client';

import type { GitRepositoryDto } from '@kubwave/api-client';
import { RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { CodeBlock } from '@/components/settings/parts';
import { SelectItem } from '@/components/ui/select';
import { serviceErrorMessage } from '@/lib/api/api-error';
import type { SshKey } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { SelectField, SettingsHint } from './parts';
import type { GitProvider, useGitRepositories } from './use-create-service';

const PROVIDER = {
	github: {
		label: 'GitHub',
		missing: 'No GitHub repositories are available yet. Install the GitHub App on the repositories you want to deploy in',
		added: 'Just added a repository to the App and don’t see it?'
	},
	gitea: {
		label: 'Gitea',
		missing: 'No Gitea repositories are available yet. Connect a Gitea account in',
		added: 'Just granted access to a repository and don’t see it?'
	}
};

export function GitRepoPicker({
	provider,
	git,
	installationId,
	repoFullName,
	onInstallationChange,
	onRepoChange,
	disabled,
	errors = {}
}: {
	provider: GitProvider;
	git: ReturnType<typeof useGitRepositories>;
	installationId: string;
	repoFullName: string;
	onInstallationChange: (installationId: string) => void;
	onRepoChange: (repo: GitRepositoryDto) => void;
	disabled?: boolean;
	errors?: { installationId?: string; repoFullName?: string };
}) {
	const { label, missing, added } = PROVIDER[provider];
	const { installations, repos, sync } = git;
	if (installations.isSuccess && installations.data.length === 0) {
		return (
			<div className="rounded-md border border-dashed px-4 py-5">
				<SettingsHint href={`/team/settings?tab=${provider}`} link={`team settings → ${label}`} className="text-sm">
					{missing}
				</SettingsHint>
			</div>
		);
	}

	const refresh = () =>
		sync.mutate(undefined, {
			onSuccess: () => toast.success('Repositories refreshed'),
			onError: err => toast.error(serviceErrorMessage(err, 'Could not refresh repositories.'))
		});

	return (
		<div className="space-y-2">
			<div className="grid gap-4 sm:grid-cols-2">
				<SelectField
					id="installationId"
					label="Account"
					value={installationId}
					onValueChange={onInstallationChange}
					placeholder={installations.isPending ? 'Loading accounts…' : 'Select an account'}
					disabled={disabled || installations.isPending}
					error={errors.installationId ?? (installations.isError ? `Could not load ${label} accounts.` : undefined)}
				>
					{(installations.data ?? []).map(installation => (
						<SelectItem key={installation.id} value={installation.id}>
							{installation.accountLogin}
						</SelectItem>
					))}
				</SelectField>
				<SelectField
					id="repoFullName"
					label="Repository"
					value={repoFullName}
					onValueChange={name => {
						const repo = repos.data?.find(candidate => candidate.repoFullName === name);
						if (repo) onRepoChange(repo);
					}}
					placeholder={installationId && repos.isPending ? 'Loading repositories…' : 'Select a repository'}
					disabled={disabled || !installationId || repos.isPending}
					error={errors.repoFullName ?? (repos.isError ? 'Could not load repositories. Refresh below to retry.' : undefined)}
				>
					{(repos.data ?? []).map(repo => (
						<SelectItem key={repo.repoFullName} value={repo.repoFullName}>
							{repo.repoFullName}
						</SelectItem>
					))}
				</SelectField>
			</div>
			{installationId && (
				<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
					{added}
					<button
						type="button"
						className="inline-flex items-center gap-1 font-medium text-foreground hover:underline disabled:opacity-50"
						disabled={disabled || sync.isPending}
						onClick={refresh}
					>
						<RefreshCwIcon className={cn('size-3', sync.isPending && 'animate-spin')} />
						{sync.isPending ? 'Syncing…' : `Refresh from ${label}`}
					</button>
				</p>
			)}
		</div>
	);
}

export function DeployKeyPicker({
	keys,
	loading,
	value,
	onChange,
	disabled,
	error
}: {
	keys: SshKey[] | undefined;
	loading: boolean;
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
	error?: string;
}) {
	const selected = keys?.find(key => key.id === value);
	const empty = keys?.length === 0;
	const failed = !loading && keys === undefined;
	return (
		<div className="space-y-3">
			<SelectField
				id="sshKeyId"
				label="Deploy key"
				value={value}
				onValueChange={onChange}
				placeholder={loading ? 'Loading deploy keys…' : 'Select a team deploy key'}
				disabled={disabled || empty || failed}
				error={error ?? (failed ? 'Could not load the team’s deploy keys.' : undefined)}
				hint={
					empty && (
						<SettingsHint href="/team/settings?tab=ssh-keys" link="Add a deploy key">
							This team has no SSH keys yet.
						</SettingsHint>
					)
				}
			>
				{(keys ?? []).map(key => (
					<SelectItem key={key.id} value={key.id}>
						{key.name} · {key.keyType}
					</SelectItem>
				))}
			</SelectField>
			{selected && (
				<div className="space-y-1.5">
					<p className="text-xs text-muted-foreground">Add this as a deploy key in your repository:</p>
					<CodeBlock value={selected.publicKey} label="Copy public key" wrap />
				</div>
			)}
		</div>
	);
}
