'use client';

import { useForm, useStore } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/form-field';
import { SelectItem } from '@/components/ui/select';
import { useTeamSshKeys } from '@/features/team-settings/use-team-settings';
import { useTeams } from '@/features/team/use-teams';
import { serviceErrorMessage } from '@/lib/api/api-error';
import { fieldError } from '@/lib/forms';
import { privateRepoErrorMessage, repoDefaults, repoNameSuggestion, repoPayload, repoSchema, type RepoSource } from './model';
import { Advanced, FormSelect, FormStep, FormTextarea, SwitchField, type SourceFormProps } from './parts';
import { DeployKeyPicker, GitRepoPicker } from './repo-pickers';
import { useCreateService, useGitRepositories } from './use-create-service';

const mono = 'font-mono text-sm';

// Public, private (SSH), GitHub and Gitea repositories share one form; only the source block differs.
export function RepoForm({ source, environmentId, taken, onCreated, onClose }: SourceFormProps & { source: RepoSource }) {
	const { activeTeamId } = useTeams();
	const [error, setError] = useState<string | null>(null);
	const create = useCreateService(environmentId);
	const form = useForm({
		defaultValues: repoDefaults,
		validators: { onSubmit: repoSchema(source, taken) },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const service = await create.mutateAsync(repoPayload(source, value, taken));
				toast.success('Service created', { description: service.name });
				onCreated([service]);
				onClose();
			} catch (err) {
				setError(source === 'private-repo' ? privateRepoErrorMessage(err) : serviceErrorMessage(err, 'Could not create service.'));
			}
		}
	});

	const provider = source === 'github-repo' ? 'github' : source === 'gitea-repo' ? 'gitea' : null;
	const installationId = useStore(form.store, state => state.values.installationId);
	const git = useGitRepositories(provider ?? 'github', provider ? activeTeamId : null, installationId);
	const sshKeys = useTeamSshKeys(source === 'private-repo' ? activeTeamId : null);

	return (
		<form.Subscribe selector={state => [state.isSubmitting, state.values, state.values.builder === 'nixpacks'] as const}>
			{([submitting, values, nixpacks]) => (
				<FormStep onSubmit={() => void form.handleSubmit()} onCancel={onClose} submitting={submitting} submitLabel="Create service">
					{provider ? (
						<form.Field name="installationId">
							{installation => (
								<form.Field name="repoFullName">
									{repo => (
										<GitRepoPicker
											provider={provider}
											git={git}
											installationId={installation.state.value}
											repoFullName={repo.state.value}
											onInstallationChange={id => {
												installation.handleChange(id);
												repo.handleChange('');
											}}
											onRepoChange={picked => {
												repo.handleChange(picked.repoFullName);
												form.setFieldValue('branch', picked.defaultBranch);
											}}
											disabled={submitting}
											errors={{ installationId: fieldError(installation.state.meta), repoFullName: fieldError(repo.state.meta) }}
										/>
									)}
								</form.Field>
							)}
						</form.Field>
					) : (
						<form.Field name="repoUrl">
							{field => (
								<FormField
									field={field}
									label="Repository URL"
									placeholder={source === 'private-repo' ? 'git@github.com:org/repo.git' : 'https://github.com/user/repo'}
									className={mono}
									autoFocus
									autoComplete="off"
								/>
							)}
						</form.Field>
					)}
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="name">
							{field => <FormField field={field} label="Name" placeholder={repoNameSuggestion(source, values, taken) || 'web'} autoComplete="off" />}
						</form.Field>
						<form.Field name="branch">{field => <FormField field={field} label="Branch" placeholder="main" className={mono} />}</form.Field>
					</div>
					{source === 'private-repo' && (
						<form.Field name="sshKeyId">
							{field => (
								<DeployKeyPicker
									keys={sshKeys.data}
									loading={sshKeys.isPending}
									value={field.state.value}
									onChange={field.handleChange}
									disabled={submitting}
									error={fieldError(field.state.meta)}
								/>
							)}
						</form.Field>
					)}
					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="builder">
							{field => (
								<FormSelect field={field} label="Build method">
									<SelectItem value="nixpacks">Nixpacks (auto-detect)</SelectItem>
									<SelectItem value="dockerfile">Dockerfile</SelectItem>
								</FormSelect>
							)}
						</form.Field>
						{!nixpacks && (
							<form.Field name="dockerfilePath">
								{field => (
									<FormField
										field={field}
										label="Dockerfile path"
										placeholder="Dockerfile"
										className={mono}
										hint={<p className="text-xs text-muted-foreground">Relative to the repo root (or root directory).</p>}
									/>
								)}
							</form.Field>
						)}
					</div>
					<Advanced>
						<form.Field name="commit">
							{field => (
								<FormField
									field={field}
									label="Commit"
									placeholder="Pin a commit SHA"
									className={mono}
									hint={<p className="text-xs text-muted-foreground">Leave blank to track the branch HEAD.</p>}
								/>
							)}
						</form.Field>
						<form.Field name="rootDirectory">
							{field => (
								<FormField
									field={field}
									label="Root directory"
									placeholder="apps/web"
									className={mono}
									hint={<p className="text-xs text-muted-foreground">Build a sub-path for a monorepo.</p>}
								/>
							)}
						</form.Field>
						{nixpacks && (
							<>
								<form.Field name="buildCommand">
									{field => <FormField field={field} label="Build command" placeholder="npm run build" className={mono} />}
								</form.Field>
								<form.Field name="startCommand">
									{field => <FormField field={field} label="Start command" placeholder="node dist/server.js" className={mono} />}
								</form.Field>
							</>
						)}
					</Advanced>
					<form.Field name="autoDeploy">
						{field => (
							<SwitchField
								field={field}
								label="Auto-deploy on push"
								description={
									provider
										? 'Redeploy when a new commit lands (via webhook, with polling as a fallback).'
										: 'Poll the branch and redeploy when a new commit lands.'
								}
							/>
						)}
					</form.Field>
					{values.autoDeploy && (
						<form.Field name="watchEntireRepo">
							{field => (
								<SwitchField
									field={field}
									label="Watch entire repository"
									description="Ignore the root directory and watch paths; deploy on any commit."
								/>
							)}
						</form.Field>
					)}
					{values.autoDeploy && !values.watchEntireRepo && (
						<form.Field name="watchPaths">
							{field => (
								<FormTextarea
									field={field}
									label="Additional watch paths"
									placeholder="packages/shared"
									className="min-h-20"
									hint="One repo-relative path per line. With a root directory set, only those paths (plus the root) trigger auto-deploy."
								/>
							)}
						</form.Field>
					)}
					<form.Field name="description">
						{field => <FormField field={field} label="Description" placeholder="Customer-facing web service" />}
					</form.Field>
					<FormError message={error} />
				</FormStep>
			)}
		</form.Subscribe>
	);
}
