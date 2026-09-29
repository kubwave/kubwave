'use client';

import type { McpCreatedAccessDto } from '@kubwave/api-client';
import { useForm } from '@tanstack/react-form';
import { BracesIcon, CheckCircle2Icon, PlusIcon, TerminalIcon, TerminalSquareIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import * as z from 'zod';
import { FormError, FormField, SubmitButton } from '@/components/form-field';
import { CodeBlock, CopyField } from '@/components/settings/parts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTeamProjects } from '@/features/project/use-project';
import { useTeams } from '@/features/team/use-teams';
import { fieldError } from '@/lib/forms';
import { MCP_EXPIRY_DAYS, MCP_SCOPES, mcpScope } from '@/lib/mcp';
import { cn } from '@/lib/utils';
import { accessSummary, type McpSnippet, mcpSnippets, type TokenDraft, tokenInput } from './mcp-model';
import { useMcpAccess } from './use-mcp-access';

const snippetIcons: Record<McpSnippet['id'], React.ComponentType> = { claude: TerminalIcon, json: BracesIcon, stdio: TerminalSquareIcon };

const tokenSchema = z.object({
	name: z.string().trim().min(1, 'Enter a name.').max(100, 'Name is too long.'),
	scopes: z.array(z.enum(MCP_SCOPES.map(scope => scope.value))).min(1, 'Pick at least one scope.'),
	teamId: z.string(),
	projectIds: z.array(z.string()),
	expiresInDays: z.enum(MCP_EXPIRY_DAYS)
});

const defaults: TokenDraft = { name: '', scopes: ['read'], teamId: 'all', projectIds: [], expiresInDays: '30' };

export function ScopeChips({ scopes }: { scopes: string[] }) {
	return scopes.map(mcpScope).map(scope => (
		<span
			key={scope.value}
			className={cn(
				'inline-flex items-center rounded border px-1.5 py-px text-[11px]',
				scope.destructive ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
			)}
		>
			{scope.label}
		</span>
	));
}

export function CreateTokenDialog() {
	const { teams } = useTeams();
	const { create } = useMcpAccess();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Shown once, kept only in component state and never persisted.
	const [created, setCreated] = useState<McpCreatedAccessDto | null>(null);
	const form = useForm({
		defaultValues: defaults,
		validators: { onSubmit: tokenSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				setCreated(await create.mutateAsync(tokenInput(value)));
			} catch {
				setError('Could not create token. Please try again.');
			}
		}
	});
	const close = () => {
		setOpen(false);
		setCreated(null);
		setError(null);
		form.reset();
		// The mutation result holds the token too; drop it with the dialog.
		create.reset();
	};
	// The token is shown only once: while it is on screen, only Done or the close button end the dialog.
	const keepOpen = (event: Event) => {
		if (created) event.preventDefault();
	};
	const snippets = created ? mcpSnippets(created.endpoint, created.token) : [];

	return (
		<Dialog open={open} onOpenChange={next => (next ? setOpen(true) : close())}>
			<DialogTrigger asChild>
				<Button size="sm">
					<PlusIcon />
					Create token
				</Button>
			</DialogTrigger>
			<DialogContent
				className="max-h-[90svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl"
				onInteractOutside={keepOpen}
				onEscapeKeyDown={keepOpen}
			>
				{created ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<CheckCircle2Icon className="size-5 text-success" />
								Token created
							</DialogTitle>
							<DialogDescription>Copy the token now. It will not be shown again.</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2">
							<CopyField value={created.token} label="Token" />
							<div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
								<ScopeChips scopes={created.access.scopes} />
								<span className="ml-1">{accessSummary(created.access, teams)}</span>
							</div>
						</div>
						<Tabs defaultValue="claude" className="gap-3">
							<TabsList className="w-full">
								{snippets.map(snippet => {
									const Icon = snippetIcons[snippet.id];
									return (
										<TabsTrigger key={snippet.id} value={snippet.id}>
											<Icon />
											{snippet.label}
										</TabsTrigger>
									);
								})}
							</TabsList>
							{snippets.map(snippet => (
								<TabsContent key={snippet.id} value={snippet.id}>
									<CodeBlock value={snippet.value} label={`Copy ${snippet.label} snippet`} wrap={snippet.wrap} />
								</TabsContent>
							))}
						</Tabs>
						<DialogFooter>
							<Button onClick={close}>Done</Button>
						</DialogFooter>
					</>
				) : (
					<form
						noValidate
						onSubmit={event => {
							event.preventDefault();
							void form.handleSubmit();
						}}
						className="grid gap-5"
					>
						<DialogHeader>
							<DialogTitle>Create personal token</DialogTitle>
							<DialogDescription>The token acts as you, limited to the scopes and team below.</DialogDescription>
						</DialogHeader>
						<form.Field name="name">
							{field => (
								<FormField
									field={field}
									label="Name"
									autoFocus
									autoComplete="off"
									placeholder="laptop claude-code"
									hint={<p className="text-xs text-muted-foreground">A label to recognise this token by.</p>}
								/>
							)}
						</form.Field>
						<form.Field name="scopes">
							{field => {
								const message = fieldError(field.state.meta);
								return (
									<fieldset className="grid gap-2">
										<legend className="mb-2 text-sm font-medium">Scopes</legend>
										<div className="divide-y rounded-md border">
											{MCP_SCOPES.map(scope => (
												<label
													key={scope.value}
													htmlFor={`scope-${scope.value}`}
													className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
												>
													<Checkbox
														id={`scope-${scope.value}`}
														className="mt-0.5"
														checked={field.state.value.includes(scope.value)}
														onCheckedChange={checked =>
															field.handleChange(current =>
																checked === true ? [...current, scope.value] : current.filter(value => value !== scope.value)
															)
														}
													/>
													<span className="grid gap-0.5">
														<span className={cn('flex items-center gap-1.5 text-sm font-medium', scope.destructive && 'text-destructive')}>
															{scope.label}
															{scope.destructive && <TriangleAlertIcon className="size-3.5" />}
															<code className="font-mono text-[10px] font-normal text-muted-foreground">{scope.value}</code>
														</span>
														<span className="text-xs text-muted-foreground">{scope.description}</span>
													</span>
												</label>
											))}
										</div>
										{message && <p className="text-xs text-destructive">{message}</p>}
									</fieldset>
								);
							}}
						</form.Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field name="teamId">
								{field => (
									<div className="grid gap-2">
										<Label htmlFor="token-team">Team access</Label>
										<Select
											value={field.state.value}
											onValueChange={teamId => {
												field.handleChange(teamId);
												form.setFieldValue('projectIds', []);
											}}
										>
											<SelectTrigger id="token-team" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="all">All my teams</SelectItem>
												{teams.map(team => (
													<SelectItem key={team.id} value={team.id}>
														{team.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
							<form.Field name="expiresInDays">
								{field => (
									<div className="grid gap-2">
										<Label htmlFor="token-expiry">Expires after</Label>
										<Select value={field.state.value} onValueChange={days => field.handleChange(days as TokenDraft['expiresInDays'])}>
											<SelectTrigger id="token-expiry" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{MCP_EXPIRY_DAYS.map(days => (
													<SelectItem key={days} value={days}>
														{days} days
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
						</div>
						<form.Subscribe selector={state => state.values.teamId}>
							{teamId =>
								teamId !== 'all' && (
									<form.Field name="projectIds">
										{field => <ProjectScope teamId={teamId} value={field.state.value} onChange={field.handleChange} />}
									</form.Field>
								)
							}
						</form.Subscribe>
						<FormError message={error} />
						<DialogFooter>
							<Button type="button" variant="outline" onClick={close}>
								Cancel
							</Button>
							<form.Subscribe selector={state => state.isSubmitting}>
								{submitting => (
									<SubmitButton pending={submitting} className="w-auto">
										Create token
									</SubmitButton>
								)}
							</form.Subscribe>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ProjectScope({ teamId, value, onChange }: { teamId: string; value: string[]; onChange: (projectIds: string[]) => void }) {
	const projects = useTeamProjects(teamId);
	return (
		<fieldset className="grid gap-2">
			<legend className="mb-1 text-sm font-medium">Projects</legend>
			<p className="text-xs text-muted-foreground">Leave all unchecked to allow every project in the team.</p>
			{projects.isPending ? (
				<Skeleton className="h-16 w-full" />
			) : projects.data?.length ? (
				<div className="max-h-44 divide-y overflow-y-auto rounded-md border">
					{projects.data.map(project => (
						<label
							key={project.id}
							htmlFor={`project-${project.id}`}
							className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"
						>
							<Checkbox
								id={`project-${project.id}`}
								checked={value.includes(project.id)}
								onCheckedChange={checked => onChange(checked === true ? [...value, project.id] : value.filter(id => id !== project.id))}
							/>
							<span className="truncate">{project.name}</span>
						</label>
					))}
				</div>
			) : (
				<p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">This team has no projects yet.</p>
			)}
		</fieldset>
	);
}
