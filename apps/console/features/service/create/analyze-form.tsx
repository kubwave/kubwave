'use client';

import { apiData, type CreateServicesFromPlanDto, type RepoSourceDto } from '@kubwave/api-client';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon, KeyRoundIcon, LoaderCircleIcon, SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field as LabeledField } from '@/components/admin/form';
import { FormError } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectItem } from '@/components/ui/select';
import { useTeamSshKeys } from '@/features/team-settings/use-team-settings';
import { useTeams } from '@/features/team/use-teams';
import type { Service } from '@/lib/api/types';
import {
	applyAnswers,
	canCreatePlan,
	includedServices,
	isSecretKey,
	noteFor,
	planErrorMessage,
	planPayload,
	questionServices,
	repoSourceInput,
	toDraft,
	usedDatabases,
	type DraftPlan,
	type RepoSourceFields
} from './analyze-model';
import { AnalyzeReview } from './analyze-review';
import { SelectField, StepBody, StepFooter, type SourceFormProps } from './parts';
import { DeployKeyPicker, GitRepoPicker } from './repo-pickers';
import { environmentApi, useCreateMutation, useGitRepositories } from './use-create-service';

const SOURCE_LABEL: Record<RepoSourceDto['type'], string> = {
	'github-repo': 'GitHub repository',
	'gitea-repo': 'Gitea repository',
	'private-repo': 'Private repository (SSH)',
	'public-repo': 'Public repository'
};

export function AnalyzeForm({ environmentId, existing, onCreated, onClose }: SourceFormProps & { existing: Service[] }) {
	const { activeTeamId } = useTeams();
	const [fields, setFields] = useState<RepoSourceFields>({
		type: 'github-repo',
		installationId: '',
		repoFullName: '',
		repoUrl: '',
		sshKeyId: '',
		branch: 'main'
	});
	const [step, setStep] = useState<'source' | 'questions' | 'review'>('source');
	const [plan, setPlan] = useState<DraftPlan | null>(null);
	const [analyzedSource, setAnalyzedSource] = useState<RepoSourceDto | null>(null);
	const [autoDeploy, setAutoDeploy] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const provider = fields.type === 'github-repo' ? 'github' : fields.type === 'gitea-repo' ? 'gitea' : null;
	const git = useGitRepositories(provider ?? 'github', provider ? activeTeamId : null, fields.installationId);
	const sshKeys = useTeamSshKeys(fields.type === 'private-repo' ? activeTeamId : null);
	const analyze = useMutation({ mutationFn: (source: RepoSourceDto) => apiData(environmentApi(environmentId).analyze.post({ source })) });
	const createFromPlan = useCreateMutation(environmentId, (input: CreateServicesFromPlanDto) =>
		apiData(environmentApi(environmentId).fromPlan.post(input))
	);

	const source = repoSourceInput(fields);
	const set = (patch: Partial<RepoSourceFields>) => setFields(current => ({ ...current, ...patch }));
	// Deep-copies the plan so the edits below can mutate like the pure helpers expect.
	const update = (edit: (draft: DraftPlan) => void) =>
		setPlan(current => {
			if (!current) return current;
			const next = structuredClone(current);
			edit(next);
			return next;
		});

	async function runAnalysis() {
		if (!source) return;
		setError(null);
		try {
			const result = await analyze.mutateAsync(source);
			const draft = toDraft(result, existing);
			setAnalyzedSource(source);
			setPlan(draft);
			if (result.services.length === 0) return setError('No deployable services were found in this repository.');
			setStep(draft.questions.length ? 'questions' : 'review');
		} catch (err) {
			setError(planErrorMessage(err, 'Analysis failed.'));
		}
	}

	async function createAll() {
		if (!plan || !analyzedSource || !canCreatePlan(plan)) return;
		setError(null);
		try {
			const created = await createFromPlan.mutateAsync(planPayload(plan, analyzedSource, autoDeploy));
			toast.success(`${created.length} ${created.length === 1 ? 'service' : 'services'} created`);
			onCreated(created);
			onClose();
		} catch (err) {
			setError(planErrorMessage(err, 'Could not create the services.'));
		}
	}

	const changeSource = () => {
		setPlan(null);
		setStep('source');
		setError(null);
	};

	if (plan && step === 'questions') {
		return (
			<>
				<StepBody>
					<p className="text-sm text-muted-foreground">
						A few details only you know. Anything you leave empty can be filled in later in the service settings.
					</p>
					{plan.questions.map(question => {
						const services = questionServices(plan, question);
						const Icon = question.kind === 'domain' ? GlobeIcon : KeyRoundIcon;
						return (
							<div key={question.id} className="space-y-3 rounded-lg border p-3">
								<div className="flex items-start gap-2">
									<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<div className="space-y-0.5">
										<p className="text-sm font-medium">{question.title}</p>
										{question.description && <p className="text-xs text-muted-foreground">{question.description}</p>}
										{question.kind === 'values' && services.length > 1 && (
											<p className="text-xs text-muted-foreground">Used by {services.map(service => service.name).join(', ')}</p>
										)}
									</div>
								</div>
								{question.kind === 'domain' ? (
									<>
										{services.map(service => (
											<Input
												key={service.id}
												aria-label={`Domain for ${service.name}`}
												value={service.domain}
												onChange={event => {
													const domain = event.target.value;
													update(draft => {
														const target = draft.services.find(candidate => candidate.id === service.id);
														if (target) target.domain = domain;
													});
												}}
												placeholder={
													plan.defaultDomainBase ? `Leave empty for ${service.name}-xxxxxxxx.${plan.defaultDomainBase}` : 'app.example.com'
												}
												className="h-8 font-mono text-xs"
											/>
										))}
										{!plan.defaultDomainBase && (
											<p className="text-xs text-warning">
												This cluster has no generated domains yet, so enter a domain you point at the cluster ingress.
											</p>
										)}
									</>
								) : (
									<div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center">
										{question.envKeys.map(key => {
											const id = `${question.id}-${key}`;
											const note = noteFor(plan, question, key);
											return (
												<div key={key} className="contents">
													<label htmlFor={id} className="truncate font-mono text-xs" title={note ?? key}>
														{key}
													</label>
													<Input
														id={id}
														type={isSecretKey(plan, question, key) ? 'password' : 'text'}
														autoComplete="new-password"
														value={plan.answers[question.id]?.[key] ?? ''}
														onChange={event => {
															const value = event.target.value;
															update(draft => {
																draft.answers[question.id] = { ...draft.answers[question.id], [key]: value };
															});
														}}
														placeholder={note ?? ''}
														className="h-8 font-mono text-xs"
													/>
												</div>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</StepBody>
				<StepFooter
					onCancel={onClose}
					start={
						<Button type="button" variant="ghost" onClick={changeSource}>
							<ArrowLeftIcon />
							Change source
						</Button>
					}
				>
					<Button
						type="button"
						onClick={() => {
							update(applyAnswers);
							setStep('review');
						}}
					>
						Show plan
						<ArrowRightIcon />
					</Button>
				</StepFooter>
			</>
		);
	}

	if (plan && step === 'review') {
		const count = includedServices(plan).length + usedDatabases(plan).length;
		return (
			<>
				<AnalyzeReview plan={plan} existing={existing} update={update} autoDeploy={autoDeploy} onAutoDeployChange={setAutoDeploy} error={error} />
				<StepFooter
					onCancel={onClose}
					start={
						<Button
							type="button"
							variant="ghost"
							disabled={createFromPlan.isPending}
							onClick={() => (plan.questions.length ? setStep('questions') : changeSource())}
						>
							<ArrowLeftIcon />
							Back
						</Button>
					}
				>
					{!canCreatePlan(plan) && <span className="mr-auto text-xs text-muted-foreground">Include at least one app service.</span>}
					<Button type="button" disabled={createFromPlan.isPending || !canCreatePlan(plan)} onClick={() => void createAll()}>
						{createFromPlan.isPending && <LoaderCircleIcon className="animate-spin" />}
						{createFromPlan.isPending ? 'Creating…' : `Create ${count} ${count === 1 ? 'service' : 'services'}`}
					</Button>
				</StepFooter>
			</>
		);
	}

	const busy = analyze.isPending;
	return (
		<>
			<StepBody>
				<div className="grid gap-4 sm:grid-cols-2">
					<SelectField
						id="analyze-source"
						label="Source"
						value={fields.type}
						onValueChange={type => set({ type: type as RepoSourceDto['type'], installationId: '', repoFullName: '' })}
						disabled={busy}
					>
						{Object.entries(SOURCE_LABEL).map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectField>
					<LabeledField label="Branch" htmlFor="analyze-branch">
						<Input
							id="analyze-branch"
							value={fields.branch}
							onChange={event => set({ branch: event.target.value })}
							placeholder="main"
							className="font-mono text-sm"
							disabled={busy}
						/>
					</LabeledField>
				</div>
				{provider ? (
					<GitRepoPicker
						provider={provider}
						git={git}
						installationId={fields.installationId}
						repoFullName={fields.repoFullName}
						onInstallationChange={installationId => set({ installationId, repoFullName: '' })}
						onRepoChange={repo => set({ repoFullName: repo.repoFullName, branch: repo.defaultBranch })}
						disabled={busy}
					/>
				) : (
					<LabeledField label="Repository URL" htmlFor="analyze-url">
						<Input
							id="analyze-url"
							value={fields.repoUrl}
							onChange={event => set({ repoUrl: event.target.value })}
							placeholder={fields.type === 'private-repo' ? 'git@github.com:org/repo.git' : 'https://github.com/org/repo.git'}
							className="font-mono text-sm"
							autoComplete="off"
							disabled={busy}
						/>
					</LabeledField>
				)}
				{fields.type === 'private-repo' && (
					<DeployKeyPicker
						keys={sshKeys.data}
						loading={sshKeys.isPending}
						value={fields.sshKeyId}
						onChange={sshKeyId => set({ sshKeyId })}
						disabled={busy}
					/>
				)}
				<p className="text-xs text-muted-foreground">
					The configured model reads the file tree, manifests, Dockerfiles, and env templates, never real .env files. Nothing is created until you
					review the proposal.
				</p>
				<FormError message={error} />
			</StepBody>
			<StepFooter onCancel={onClose}>
				<Button type="button" disabled={!source || busy} onClick={() => void runAnalysis()}>
					{busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
					{busy ? 'Analyzing… this can take a minute' : 'Analyze repository'}
				</Button>
			</StepFooter>
		</>
	);
}
