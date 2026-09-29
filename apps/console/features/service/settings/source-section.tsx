'use client';

import { apiData } from '@kubwave/api-client';
import { useQuery } from '@tanstack/react-query';
import { EyeIcon, EyeOffIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useTeams } from '@/features/team/use-teams';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { formatRelative } from '@/lib/format';
import { rowId, type Row } from '@/lib/service-settings';
import { DATABASE_ENGINE_UI, isDatabaseEngine, type DatabaseEngine } from '@/lib/service-types';
import { FieldError, Group, RemoveRowButton, replaceAt, TextSetting, ToggleSetting, type SectionProps } from './fields';

export function SourceSection(props: SectionProps) {
	const { type } = props.service;
	if (isDatabaseEngine(type)) return <DatabaseSource {...props} engine={type} />;
	if (type === 'docker-image') return <ImageSource {...props} />;
	if (type === 'dockerfile') return <DockerfileSource {...props} />;
	return <RepoSource {...props} />;
}

function ImageSource({ service, values, errors, set }: SectionProps) {
	const auth = values.registryAuth;
	const watch = service.imageWatch;
	return (
		<>
			<Group>
				<div className="grid gap-3 @md:grid-cols-[minmax(0,1fr)_9rem]">
					<TextSetting label="Image" value={values.image} onValueChange={image => set({ image })} error={errors.image} mono placeholder="nginx" />
					<TextSetting label="Tag" value={values.tag} onValueChange={tag => set({ tag })} error={errors.tag} mono placeholder="latest" />
				</div>
				<ToggleSetting
					label="Watch for updates"
					hint={
						watch.lastError
							? `Last check failed: ${watch.lastError}`
							: watch.lastCheckedAt
								? `Redeploys when the tag points to a new digest. Checked ${formatRelative(watch.lastCheckedAt)}.`
								: 'Redeploy automatically when the tag points to a new digest.'
					}
					checked={values.imageWatch.enabled}
					onCheckedChange={enabled => set({ imageWatch: { enabled } })}
				/>
			</Group>
			<Group title="Private registry" description="Authenticate image pulls with a username and token.">
				<ToggleSetting
					label="Use registry credentials"
					checked={auth.enabled}
					onCheckedChange={enabled => set({ registryAuth: { ...auth, enabled } })}
				/>
				{auth.enabled && (
					<div className="grid gap-3 @md:grid-cols-2">
						<TextSetting
							className="@md:col-span-2"
							label="Server"
							value={auth.server}
							onValueChange={server => set({ registryAuth: { ...auth, server } })}
							error={errors['registryAuth.server']}
							mono
							placeholder="ghcr.io"
						/>
						<TextSetting
							label="Username"
							value={auth.username}
							onValueChange={username => set({ registryAuth: { ...auth, username } })}
							error={errors['registryAuth.username']}
							mono
						/>
						<TextSetting
							label="Password or token"
							type="password"
							autoComplete="off"
							value={auth.password}
							onValueChange={password => set({ registryAuth: { ...auth, password } })}
							error={errors['registryAuth.password']}
							placeholder={auth.hasPassword ? 'Stored — type to replace' : undefined}
						/>
					</div>
				)}
			</Group>
			<Group title="Start" description="Override the image entrypoint and its arguments, one token per row. Empty keeps the image default.">
				<TokenRows title="Command" item="token" rows={values.command} placeholder="/docker-entrypoint.sh" onChange={command => set({ command })} />
				<TokenRows title="Arguments" item="argument" rows={values.args} placeholder="--port" onChange={args => set({ args })} />
			</Group>
		</>
	);
}

type Tokens = Row<{ value: string }>[];

function TokenRows({
	title,
	item,
	rows,
	placeholder,
	onChange
}: {
	title: string;
	item: string;
	rows: Tokens;
	placeholder: string;
	onChange: (rows: Tokens) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs">{title}</Label>
			{rows.map((row, index) => (
				<div key={row._id} className="flex items-center gap-2">
					<Input
						value={row.value}
						onChange={event => onChange(replaceAt(rows, index, { value: event.target.value }))}
						placeholder={placeholder}
						className="h-8 font-mono text-xs"
						aria-label={`${title} ${item} ${index + 1}`}
					/>
					<RemoveRowButton label={`Remove ${item} ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
				</div>
			))}
			<Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { _id: rowId(), value: '' }])}>
				<PlusIcon /> Add {item}
			</Button>
		</div>
	);
}

function DockerfileSource({ values, errors, set }: SectionProps) {
	return (
		<Group description="Built in-cluster on every deploy.">
			<Textarea
				value={values.dockerfile}
				onChange={event => set({ dockerfile: event.target.value })}
				className="min-h-56 font-mono text-xs leading-5"
				spellCheck={false}
				aria-label="Dockerfile"
				aria-invalid={errors.dockerfile ? true : undefined}
			/>
			<FieldError message={errors.dockerfile} />
		</Group>
	);
}

function RepoSource({ service, values, errors, set }: SectionProps) {
	const linked = service.type === 'github-repo' || service.type === 'gitea-repo';
	return (
		<Group
			description={
				linked
					? 'Linked through the connected app. To move to a different repository, recreate the service.'
					: 'Redeploy to pick up the latest commit on the branch.'
			}
		>
			<div className="grid gap-3 @md:grid-cols-[minmax(0,1fr)_10rem]">
				{linked ? (
					<TextSetting label="Repository" value={values.repoFullName} onValueChange={() => undefined} error={errors.repoFullName} mono readOnly />
				) : (
					<TextSetting
						label="Repository"
						value={values.repoUrl}
						onValueChange={repoUrl => set({ repoUrl })}
						error={errors.repoUrl}
						mono
						placeholder={service.type === 'private-repo' ? 'git@github.com:org/repo.git' : 'https://github.com/org/repo'}
					/>
				)}
				<TextSetting label="Branch" value={values.branch} onValueChange={branch => set({ branch })} error={errors.branch} mono placeholder="main" />
			</div>
			<div className="grid gap-3 @md:grid-cols-2">
				<TextSetting
					label="Root directory"
					value={values.rootDirectory}
					onValueChange={rootDirectory => set({ rootDirectory })}
					mono
					placeholder="apps/web"
					hint="Build from a subdirectory in a monorepo."
				/>
				<TextSetting
					label="Pinned commit"
					value={values.commit}
					onValueChange={commit => set({ commit })}
					error={errors.commit}
					mono
					placeholder="Latest on the branch"
					hint="Blank tracks the branch head on each deploy."
				/>
			</div>
			{service.type === 'private-repo' && (
				<DeployKeySelect value={values.sshKeyId} error={errors.sshKeyId} onChange={sshKeyId => set({ sshKeyId })} />
			)}
		</Group>
	);
}

function DeployKeySelect({ value, error, onChange }: { value: string; error?: string; onChange: (sshKeyId: string) => void }) {
	const { activeTeamId } = useTeams();
	const keys = useQuery({
		queryKey: queryKeys.teamSshKeys(activeTeamId ?? 'none'),
		queryFn: () => apiData(getBrowserApi().teams(activeTeamId!).sshKeys.get()),
		enabled: Boolean(activeTeamId)
	});
	const selected = keys.data?.find(key => key.id === value);
	return (
		<div className="space-y-1.5">
			<Label className="text-xs">Deploy key</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger size="sm" className="w-full" aria-invalid={error ? true : undefined}>
					<SelectValue placeholder={keys.isPending ? 'Loading keys…' : 'Select a deploy key'} />
				</SelectTrigger>
				<SelectContent>
					{(keys.data ?? []).map(key => (
						<SelectItem key={key.id} value={key.id}>
							{key.name} · {key.keyType}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<FieldError message={error} />
			{selected && (
				<div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
					<code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{selected.publicKey}</code>
					<CopyButton value={selected.publicKey} label="Copy public key" />
				</div>
			)}
		</div>
	);
}

function DatabaseSource({ service, values, errors, set, engine }: SectionProps & { engine: DatabaseEngine }) {
	const ui = DATABASE_ENGINE_UI[engine];
	return (
		<>
			<Group title={ui.label} description="The engine version and how much storage backs the database.">
				<div className="grid gap-3 @md:grid-cols-2">
					<div className="space-y-1.5">
						<Label className="text-xs">Version</Label>
						<Select value={values.version} onValueChange={version => set({ version })}>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue placeholder="Select a version" />
							</SelectTrigger>
							<SelectContent>
								{ui.versions.map(version => (
									<SelectItem key={version} value={version}>
										{ui.label} {version}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<FieldError message={errors.version} />
					</div>
					<TextSetting
						label="Storage"
						value={values.storage}
						onValueChange={storage => set({ storage })}
						error={errors.storage}
						mono
						hint="Storage can grow but never shrink."
					/>
				</div>
			</Group>
			<DatabaseConnection serviceId={service.id} />
		</>
	);
}

// Connection details (including the generated password) come from their own endpoint, never the service payload.
function DatabaseConnection({ serviceId }: { serviceId: string }) {
	const [revealed, setRevealed] = useState(false);
	const connection = useQuery({
		queryKey: queryKeys.serviceConnection(serviceId),
		queryFn: () => apiData(getBrowserApi().services(serviceId).connection.get())
	});
	const data = connection.data;
	const mask = (value: string) => (revealed || !data ? value : value.replaceAll(data.password, '••••••••'));
	const rows = data
		? [
				{ label: 'Host', value: data.host },
				{ label: 'Port', value: String(data.port) },
				{ label: 'Database', value: data.database },
				{ label: 'Username', value: data.username },
				{ label: 'Password', value: data.password },
				{ label: 'URL', value: data.uri },
				...(data.externalUri ? [{ label: 'Public URL', value: data.externalUri }] : [])
			]
		: [];
	return (
		<Group
			title="Connection"
			description="Reference these from another service's variables to connect over the internal network."
			action={
				data && (
					<Button variant="ghost" size="sm" onClick={() => setRevealed(value => !value)}>
						{revealed ? <EyeOffIcon /> : <EyeIcon />}
						{revealed ? 'Hide' : 'Reveal'}
					</Button>
				)
			}
		>
			{connection.isPending ? (
				<Skeleton className="h-44 w-full" />
			) : !data ? (
				<p className="text-sm text-destructive">Could not load connection details.</p>
			) : (
				<div className="divide-y rounded-lg border text-sm">
					{rows.map(row => (
						<div key={row.label} className="flex items-center gap-3 px-3 py-1.5">
							<span className="w-24 shrink-0 text-xs text-muted-foreground">{row.label}</span>
							<span className="min-w-0 flex-1 truncate font-mono text-xs">{mask(row.value)}</span>
							<CopyButton value={row.value} label={`Copy ${row.label.toLowerCase()}`} />
						</div>
					))}
				</div>
			)}
		</Group>
	);
}
