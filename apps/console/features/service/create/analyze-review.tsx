'use client';

import {
	BoxIcon,
	ChevronDownIcon,
	ClipboardPasteIcon,
	DatabaseIcon,
	GlobeIcon,
	KeyRoundIcon,
	PlusIcon,
	TriangleAlertIcon,
	XIcon
} from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
	LITERAL,
	REFERENCE_LABEL,
	addEnv,
	applyPaste,
	databaseUsers,
	domainLabel,
	isReference,
	missingCount,
	needsValue,
	setIncluded,
	targetOptions,
	totalMissing,
	type DraftEnv,
	type DraftPlan,
	type DraftService,
	type ExistingService
} from './analyze-model';
import { StepBody, SwitchRow } from './parts';

type Update = (edit: (draft: DraftPlan) => void) => void;

const small = 'h-8 font-mono text-xs';

export function AnalyzeReview({
	plan,
	existing,
	update,
	autoDeploy,
	onAutoDeployChange,
	error
}: {
	plan: DraftPlan;
	existing: readonly ExistingService[];
	update: Update;
	autoDeploy: boolean;
	onAutoDeployChange: (value: boolean) => void;
	error: string | null;
}) {
	const [expanded, setExpanded] = useState<string | null>(null);
	const missing = totalMissing(plan);
	return (
		<StepBody className="space-y-2">
			{plan.warnings.length > 0 && (
				<details className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
					<summary className="flex cursor-pointer items-center gap-1.5 font-medium">
						<TriangleAlertIcon className="size-3.5 text-warning" />
						{plan.warnings.length} {plan.warnings.length === 1 ? 'note' : 'notes'} from the analysis
					</summary>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
						{plan.warnings.map((warning, index) => (
							<li key={index}>{warning}</li>
						))}
					</ul>
				</details>
			)}

			{plan.services.map(service => (
				<ServiceCard
					key={service.id}
					plan={plan}
					service={service}
					existing={existing}
					update={update}
					expanded={expanded === service.id && service.include}
					onToggle={() => setExpanded(current => (current === service.id ? null : service.id))}
				/>
			))}

			{plan.databases.length > 0 && (
				<div className="space-y-2 rounded-lg border px-3 py-2">
					<p className="flex items-center gap-1.5 text-xs font-medium">
						<DatabaseIcon className="size-3.5" /> New databases
					</p>
					{plan.databases.map(database => {
						const users = databaseUsers(plan, database);
						return (
							<div key={database.id} className="flex items-center gap-2">
								<Input
									aria-label="Database name"
									value={database.name}
									onChange={event => {
										const name = event.target.value;
										update(draft => {
											const target = draft.databases.find(candidate => candidate.id === database.id);
											if (target) target.name = name;
										});
									}}
									className="h-7 w-1/3 font-mono text-xs"
								/>
								<Badge variant="secondary" className="font-normal">
									{database.engine}
								</Badge>
								<span className="text-xs text-muted-foreground">
									{users.length ? `used by ${users.join(', ')}` : 'not referenced, will not be created'}
								</span>
							</div>
						);
					})}
				</div>
			)}

			<div className="pt-2">
				<SwitchRow
					id="analyze-auto-deploy"
					label="Auto-deploy on push"
					description="Redeploy a service when a commit touches its root directory or watch paths."
					checked={autoDeploy}
					onCheckedChange={onAutoDeployChange}
				/>
			</div>
			{missing > 0 && (
				<p className="text-xs text-warning">
					{missing} {missing === 1 ? 'variable is' : 'variables are'} still empty and will be skipped. Add them later in the service settings.
				</p>
			)}
			<FormError message={error} />
		</StepBody>
	);
}

function ServiceCard({
	plan,
	service,
	existing,
	update,
	expanded,
	onToggle
}: {
	plan: DraftPlan;
	service: DraftService;
	existing: readonly ExistingService[];
	update: Update;
	expanded: boolean;
	onToggle: () => void;
}) {
	const [pasting, setPasting] = useState(false);
	const [pasteText, setPasteText] = useState('');
	const edit = (change: (target: DraftService) => void) =>
		update(draft => {
			const target = draft.services.find(candidate => candidate.id === service.id);
			if (target) change(target);
		});
	const set =
		<K extends keyof DraftService>(key: K) =>
		(value: DraftService[K]) =>
			edit(target => void (target[key] = value));
	const text = (
		key:
			| 'name'
			| 'image'
			| 'tag'
			| 'containerPort'
			| 'args'
			| 'rootDirectory'
			| 'dockerfilePath'
			| 'buildCommand'
			| 'startCommand'
			| 'watchPaths'
			| 'domain'
	) => ({
		value: service[key],
		onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key)(event.target.value)
	});
	const missing = missingCount(service);

	return (
		<div className={cn('rounded-lg border', !service.include && 'opacity-60')}>
			<div className="flex items-center gap-3 px-3 py-2">
				<Checkbox
					checked={service.include}
					onCheckedChange={checked => update(draft => setIncluded(draft, service.id, checked === true))}
					aria-label={`Create ${service.name}`}
				/>
				<button type="button" className="flex min-w-0 flex-1 flex-col text-left" disabled={!service.include} onClick={onToggle}>
					<span className="flex flex-wrap items-center gap-1.5">
						<span className="text-sm font-medium">{service.name}</span>
						{service.kind === 'image' ? (
							<Badge variant="secondary" className="gap-1 font-mono font-normal">
								<BoxIcon className="size-3" />
								{service.image}:{service.tag}
							</Badge>
						) : (
							<Badge variant="secondary" className="font-normal">
								{service.builder === 'dockerfile' ? 'Dockerfile' : 'Nixpacks'}
							</Badge>
						)}
						{service.containerPort && (
							<Badge variant="secondary" className="font-mono font-normal">
								:{service.containerPort}
							</Badge>
						)}
						<Badge variant="outline" className="gap-1 font-normal">
							<GlobeIcon className="size-3" />
							{domainLabel(plan, service)}
						</Badge>
					</span>
					<span className="truncate text-xs text-muted-foreground" title={service.reason}>
						{service.reason}
					</span>
				</button>
				<span className="shrink-0 text-xs text-muted-foreground">
					{service.env.length} env
					{missing > 0 && <span className="text-warning"> · {missing} empty</span>}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={!service.include}
					aria-label={expanded ? 'Collapse' : 'Edit'}
					onClick={onToggle}
				>
					<ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
				</Button>
			</div>

			{expanded && (
				<div className="space-y-3 border-t px-3 py-3">
					<div className="grid gap-3 sm:grid-cols-3">
						<Small label="Name">
							<Input {...text('name')} className="h-8 text-xs" />
						</Small>
						{service.kind === 'image' ? (
							<>
								<Small label="Image">
									<Input {...text('image')} placeholder="minio/minio" className={small} />
								</Small>
								<Small label="Tag">
									<Input {...text('tag')} className={small} />
								</Small>
							</>
						) : (
							<Small label="Build method">
								<Select value={service.builder} onValueChange={value => set('builder')(value as DraftService['builder'])}>
									<SelectTrigger size="sm" className="w-full text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="nixpacks">Nixpacks</SelectItem>
										<SelectItem value="dockerfile">Dockerfile</SelectItem>
									</SelectContent>
								</Select>
							</Small>
						)}
						<Small label="Port">
							<Input {...text('containerPort')} placeholder="none" inputMode="numeric" className={small} />
						</Small>
						{service.kind === 'image' ? (
							<>
								<Small label="Arguments" hint="Passed to the image entrypoint, one per line." className="sm:col-span-2">
									<Textarea {...text('args')} placeholder={'server\n/data'} className="min-h-16 font-mono text-xs" />
								</Small>
								<div className="flex flex-col gap-1 sm:col-span-3">
									<span className="text-xs font-medium">Volumes</span>
									{service.volumes.length === 0 && <p className="text-xs text-muted-foreground">No persistent storage.</p>}
									{service.volumes.map(volume => {
										const setVolume = (key: 'name' | 'mountPath' | 'size') => (event: React.ChangeEvent<HTMLInputElement>) => {
											const value = event.target.value;
											edit(target => {
												const entry = target.volumes.find(candidate => candidate.id === volume.id);
												if (entry) entry[key] = value;
											});
										};
										return (
											<div key={volume.id} className="flex items-center gap-2">
												<Input
													aria-label="Volume name"
													value={volume.name}
													onChange={setVolume('name')}
													placeholder="data"
													className={cn(small, 'w-1/4')}
												/>
												<Input
													aria-label="Mount path"
													value={volume.mountPath}
													onChange={setVolume('mountPath')}
													placeholder="/data"
													className={cn(small, 'flex-1')}
												/>
												<Input aria-label="Size" value={volume.size} onChange={setVolume('size')} placeholder="5Gi" className={cn(small, 'w-20')} />
												<IconButton
													label="Remove volume"
													onClick={() => edit(target => void (target.volumes = target.volumes.filter(candidate => candidate.id !== volume.id)))}
												>
													<XIcon />
												</IconButton>
											</div>
										);
									})}
								</div>
							</>
						) : (
							<>
								<Small label="Root directory">
									<Input {...text('rootDirectory')} placeholder="(repo root)" className={small} />
								</Small>
								{service.builder === 'dockerfile' ? (
									<Small label="Dockerfile path" className="sm:col-span-2">
										<Input {...text('dockerfilePath')} placeholder="Dockerfile" className={small} />
									</Small>
								) : (
									<>
										<Small label="Build command">
											<Input {...text('buildCommand')} placeholder="auto" className={small} />
										</Small>
										<Small label="Start command">
											<Input {...text('startCommand')} placeholder="auto" className={small} />
										</Small>
									</>
								)}
								<Small label="Watch paths" hint="One repo-relative path per line." className="sm:col-span-3">
									<Textarea {...text('watchPaths')} placeholder="packages/shared" className="min-h-16 font-mono text-xs" />
								</Small>
							</>
						)}
						<div className="flex items-center gap-3 sm:col-span-3">
							<Label className="flex shrink-0 items-center gap-2 text-xs font-normal">
								<Switch checked={service.publicDomain} onCheckedChange={set('publicDomain')} />
								Public
							</Label>
							{service.publicDomain && (
								<Input
									{...text('domain')}
									aria-label="Domain"
									placeholder={plan.defaultDomainBase ? `Domain, leave empty for a generated ${plan.defaultDomainBase} domain` : 'app.example.com'}
									className={cn(small, 'flex-1')}
								/>
							)}
						</div>
					</div>

					<div className="space-y-1.5">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium">Environment</span>
							<div className="flex gap-1">
								<Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPasting(!pasting)}>
									<ClipboardPasteIcon />
									Paste .env
								</Button>
								<Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => edit(addEnv)}>
									<PlusIcon />
									Add
								</Button>
							</div>
						</div>
						{pasting && (
							<div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-2">
								<Textarea
									aria-label="Paste .env"
									value={pasteText}
									onChange={event => setPasteText(event.target.value)}
									placeholder="KEY=value"
									className="min-h-24 font-mono text-xs"
								/>
								<Button
									type="button"
									size="sm"
									className="self-end"
									disabled={!pasteText.trim()}
									onClick={() => {
										edit(target => applyPaste(target, pasteText));
										setPasteText('');
										setPasting(false);
									}}
								>
									Fill values
								</Button>
							</div>
						)}
						{service.env.map(entry => (
							<EnvRow key={entry.id} plan={plan} service={service} entry={entry} existing={existing} edit={edit} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function EnvRow({
	plan,
	service,
	entry,
	existing,
	edit
}: {
	plan: DraftPlan;
	service: DraftService;
	entry: DraftEnv;
	existing: readonly ExistingService[];
	edit: (change: (target: DraftService) => void) => void;
}) {
	const patch = (changes: Partial<DraftEnv>) =>
		edit(target => {
			const current = target.env.find(candidate => candidate.id === entry.id);
			if (current) Object.assign(current, changes);
		});
	const reference = isReference(entry);
	return (
		<div className="flex items-center gap-2">
			<Input
				aria-label="Key"
				value={entry.key}
				onChange={event => patch({ key: event.target.value })}
				placeholder="KEY"
				title={entry.note ?? undefined}
				className={cn(small, 'w-2/5 shrink-0')}
			/>
			{entry.kind && (
				<Select value={entry.target} onValueChange={target => patch({ target })}>
					<SelectTrigger size="sm" className="min-w-0 flex-1 text-xs">
						<SelectValue placeholder="Enter a value instead" />
					</SelectTrigger>
					<SelectContent>
						{targetOptions(plan, entry, service, existing).map(option => (
							<SelectItem key={option.value} value={option.value}>
								{REFERENCE_LABEL[entry.kind!]} {option.label}
							</SelectItem>
						))}
						<SelectItem value={LITERAL}>Enter a value instead</SelectItem>
					</SelectContent>
				</Select>
			)}
			{!reference && (
				<Input
					aria-label={`Value of ${entry.key || 'variable'}`}
					value={entry.value}
					onChange={event => patch({ value: event.target.value })}
					type={entry.secret ? 'password' : 'text'}
					autoComplete="new-password"
					placeholder={entry.generate ? 'generated automatically' : (entry.note ?? (entry.secret ? 'secret value' : 'value'))}
					title={entry.note ?? undefined}
					className={cn(small, 'min-w-0 flex-1', needsValue(entry) && 'border-warning/60')}
				/>
			)}
			<IconButton
				label={entry.secret ? 'Stored as secret' : 'Store as secret'}
				className={entry.secret ? 'text-primary-text' : undefined}
				disabled={reference && entry.kind === 'connectionUri'}
				onClick={() => patch({ secret: !entry.secret })}
			>
				<KeyRoundIcon />
			</IconButton>
			<IconButton label="Remove" onClick={() => edit(target => void (target.env = target.env.filter(candidate => candidate.id !== entry.id)))}>
				<XIcon />
			</IconButton>
		</div>
	);
}

function Small({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
	return (
		<label className={cn('flex flex-col gap-1', className)}>
			<span className="text-xs font-medium">{label}</span>
			{children}
			{hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
		</label>
	);
}

function IconButton({ label, className, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			title={label}
			className={cn('shrink-0 text-muted-foreground hover:text-foreground', className)}
			{...props}
		/>
	);
}
