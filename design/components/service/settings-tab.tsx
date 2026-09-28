'use client';

import { AlertTriangleIcon, EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDelete } from '@/components/confirm-delete';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { databaseEngines, isDatabase, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';

type Stage = (kind: string) => void;

const isRepo = (s: Service) => ['github-repo', 'gitea-repo', 'public-repo', 'private-repo'].includes(s.type);

export function SettingsTab({ service, onStage, onDelete }: { service: Service; onStage: Stage; onDelete: () => void }) {
	const sections = [
		{ id: 'source', label: 'Source' },
		...(isRepo(service) || service.type === 'dockerfile' ? [{ id: 'build', label: 'Build & deploy' }] : []),
		{ id: 'networking', label: 'Networking' },
		{ id: 'resources', label: 'Resources & scaling' },
		{ id: 'volumes', label: 'Volumes' },
		...(service.type === 'docker-image' ? [{ id: 'config', label: 'Config files' }] : []),
		{ id: 'danger', label: 'Danger zone' }
	];
	const [active, setActive] = useState('source');

	return (
		<div className="grid gap-6 sm:grid-cols-[150px_1fr]">
			<nav className="flex gap-1 overflow-x-auto sm:sticky sm:top-0 sm:flex-col sm:self-start" aria-label="Service settings">
				{sections.map(s => (
					<button
						key={s.id}
						type="button"
						onClick={() => setActive(s.id)}
						className={cn(
							'shrink-0 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
							active === s.id && 'bg-accent font-medium text-foreground',
							s.id === 'danger' && 'sm:mt-4'
						)}
					>
						{s.label}
					</button>
				))}
			</nav>
			<div className="min-w-0 space-y-6">
				{active === 'source' && <Source service={service} onStage={onStage} />}
				{active === 'build' && <Build service={service} onStage={onStage} />}
				{active === 'networking' && <Networking service={service} onStage={onStage} />}
				{active === 'resources' && <Resources onStage={onStage} />}
				{active === 'volumes' && <Volumes service={service} onStage={onStage} />}
				{active === 'config' && <ConfigFiles onStage={onStage} />}
				{active === 'danger' && (
					<Group title="Delete service" description="Removes the workload, its domains and its deployment history. Volumes are deleted too.">
						<ConfirmDelete name={service.name} title={`Delete ${service.name}?`} description="This cannot be undone." onConfirm={onDelete}>
							<Button variant="destructive" size="sm">
								<Trash2Icon /> Delete service
							</Button>
						</ConfirmDelete>
					</Group>
				)}
			</div>
		</div>
	);
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
	return (
		<section className="space-y-3">
			<div>
				<h3 className="text-sm font-medium">{title}</h3>
				{description && <p className="text-xs text-muted-foreground">{description}</p>}
			</div>
			{children}
		</section>
	);
}

function Field({
	label,
	hint,
	stage,
	kind,
	mono,
	className,
	...props
}: React.ComponentProps<typeof Input> & { label: string; hint?: string; stage: Stage; kind: string; mono?: boolean }) {
	const id = `f-${label.toLowerCase().replace(/\W+/g, '-')}`;
	return (
		<div className={cn('space-y-1.5', className)}>
			<Label htmlFor={id} className="text-xs">
				{label}
			</Label>
			<Input id={id} className={cn('h-8', mono && 'font-mono text-xs')} onChange={() => stage(kind)} {...props} />
			{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
		</div>
	);
}

function Toggle({
	label,
	hint,
	defaultChecked,
	stage,
	kind
}: {
	label: string;
	hint?: string;
	defaultChecked?: boolean;
	stage: Stage;
	kind: string;
}) {
	const id = `t-${label.toLowerCase().replace(/\W+/g, '-')}`;
	return (
		<div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
			<div>
				<Label htmlFor={id} className="text-sm">
					{label}
				</Label>
				{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
			</div>
			<Switch id={id} defaultChecked={defaultChecked} onCheckedChange={() => stage(kind)} />
		</div>
	);
}

function Source({ service, onStage }: { service: Service; onStage: Stage }) {
	if (isDatabase(service.type)) return <DatabaseSource service={service} onStage={onStage} />;
	if (service.type === 'docker-image') {
		const [image, tag] = service.source.split(/:(?=[^:]*$)/);
		return (
			<>
				<Group title="Image">
					<div className="grid gap-3 sm:grid-cols-[1fr_140px]">
						<Field label="Image" defaultValue={image} mono stage={onStage} kind="source" />
						<Field label="Tag" defaultValue={tag ?? 'latest'} mono stage={onStage} kind="source" />
					</div>
					<Toggle
						label="Watch for updates"
						hint="Redeploy automatically when the tag points to a new digest."
						defaultChecked
						stage={onStage}
						kind="source"
					/>
					<Toggle label="Private registry" hint="Authenticate pulls with a username and token." stage={onStage} kind="source" />
				</Group>
				<Group title="Start" description="Override the image entrypoint and arguments.">
					<Field label="Command" placeholder="/docker-entrypoint.sh" mono stage={onStage} kind="source" />
					<Field label="Arguments" placeholder="--port 8080" mono stage={onStage} kind="source" />
				</Group>
			</>
		);
	}
	if (service.type === 'dockerfile') {
		return (
			<Group title="Dockerfile" description="Built in-cluster on every deploy.">
				<Textarea
					defaultValue={'FROM node:24-alpine\nWORKDIR /app\nCOPY . .\nRUN bun install --production\nEXPOSE 4000\nCMD ["bun", "run", "start"]'}
					className="min-h-48 font-mono text-xs leading-5"
					spellCheck={false}
					onChange={() => onStage('source')}
					aria-label="Dockerfile"
				/>
			</Group>
		);
	}
	return (
		<>
			<Group title="Repository">
				<div className="grid gap-3 sm:grid-cols-[1fr_160px]">
					<Field label="Repository" defaultValue={service.source} mono stage={onStage} kind="source" />
					<Field label="Branch" defaultValue={service.branch} mono stage={onStage} kind="source" />
				</div>
				<Field label="Root directory" placeholder="/" mono stage={onStage} kind="source" hint="Build from a subdirectory in a monorepo." />
				{service.type === 'private-repo' && (
					<div className="space-y-1.5">
						<Label className="text-xs">Deploy key</Label>
						<Select defaultValue="ci" onValueChange={() => onStage('source')}>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ci">ci-deploy · ed25519</SelectItem>
								<SelectItem value="legacy">legacy-jobs · rsa</SelectItem>
							</SelectContent>
						</Select>
					</div>
				)}
			</Group>
			<Group title="Auto-deploy">
				<Toggle
					label="Deploy on push"
					hint={`Every push to ${service.branch ?? 'main'} triggers a deploy.`}
					defaultChecked
					stage={onStage}
					kind="source"
				/>
				<Toggle label="Watch entire repository" hint="Off: only pushes touching the watch paths deploy." stage={onStage} kind="source" />
				<Field label="Watch paths" defaultValue="src/**, package.json" mono stage={onStage} kind="source" />
			</Group>
		</>
	);
}

function DatabaseSource({ service, onStage }: { service: Service; onStage: Stage }) {
	const [reveal, setReveal] = useState(false);
	const engine = databaseEngines.find(e => e.type === service.type)!;
	const password = service.vars.find(v => v.secret)?.value ?? 'q8Zp2LmN4x';
	const conn = `${service.type === 'postgres' ? 'postgresql' : service.type === 'mongodb' ? 'mongodb' : 'mysql'}://app:${reveal ? password : '••••••••'}@${service.internalHost}:${service.port}/app`;
	return (
		<>
			<Group title="Engine">
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label className="text-xs">Version</Label>
						<Select defaultValue={service.source.split(' ').pop()} onValueChange={() => onStage('engine')}>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{engine.versions.map(v => (
									<SelectItem key={v} value={v}>
										{engine.name} {v}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Field label="Storage" defaultValue={service.volume?.size ?? '10Gi'} mono stage={onStage} kind="engine" />
				</div>
			</Group>
			<Group title="Connection" description="Available to other services in this environment.">
				<div className="divide-y rounded-lg border text-sm">
					{[
						['Host', service.internalHost],
						['Port', String(service.port)],
						['Database', 'app'],
						['Username', 'app']
					].map(([k, v]) => (
						<div key={k} className="flex items-center gap-3 px-3 py-2">
							<span className="w-24 text-xs text-muted-foreground">{k}</span>
							<span className="flex-1 truncate font-mono text-xs">{v}</span>
							<CopyButton value={v!} label={`Copy ${k}`} />
						</div>
					))}
					<div className="flex items-center gap-3 px-3 py-2">
						<span className="w-24 text-xs text-muted-foreground">Password</span>
						<span className="flex-1 truncate font-mono text-xs">{reveal ? password : '••••••••••'}</span>
						<Button variant="ghost" size="icon-xs" onClick={() => setReveal(r => !r)} aria-label={reveal ? 'Hide password' : 'Show password'}>
							{reveal ? <EyeOffIcon /> : <EyeIcon />}
						</Button>
						<CopyButton value={password} label="Copy password" />
					</div>
					<div className="flex items-center gap-3 bg-muted/40 px-3 py-2">
						<span className="w-24 text-xs text-muted-foreground">URL</span>
						<span className="flex-1 truncate font-mono text-xs">{conn}</span>
						<CopyButton value={conn} label="Copy connection string" />
					</div>
				</div>
				<div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
					<AlertTriangleIcon className="size-4 shrink-0 text-warning" />
					<div>
						<div className="font-medium">Public access is off</div>
						<div className="text-muted-foreground">Expose a TCP port under Networking to connect from outside the cluster.</div>
					</div>
				</div>
			</Group>
		</>
	);
}

function Build({ service, onStage }: { service: Service; onStage: Stage }) {
	const [builder, setBuilder] = useState(service.type === 'dockerfile' ? 'dockerfile' : 'nixpacks');
	return (
		<Group title="Builder">
			<RadioGroup
				value={builder}
				onValueChange={v => {
					setBuilder(v);
					onStage('build');
				}}
				className="grid grid-cols-2 gap-2"
			>
				{[
					['nixpacks', 'Nixpacks', 'Detects the stack automatically'],
					['dockerfile', 'Dockerfile', 'Use a Dockerfile from the repo']
				].map(([v, l, d]) => (
					<Label
						key={v}
						htmlFor={`b-${v}`}
						className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-3 font-normal', builder === v && 'border-primary bg-primary/5')}
					>
						<RadioGroupItem id={`b-${v}`} value={v!} className="mt-0.5" />
						<span>
							<span className="block text-sm font-medium">{l}</span>
							<span className="text-xs text-muted-foreground">{d}</span>
						</span>
					</Label>
				))}
			</RadioGroup>
			{builder === 'dockerfile' ? (
				<Field label="Dockerfile path" defaultValue="Dockerfile" mono stage={onStage} kind="build" />
			) : (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="Build command" placeholder="bun run build" mono stage={onStage} kind="build" />
					<Field label="Start command" placeholder="bun run start" mono stage={onStage} kind="build" />
				</div>
			)}
		</Group>
	);
}

function Networking({ service, onStage }: { service: Service; onStage: Stage }) {
	const [domains, setDomains] = useState(service.domain ? [{ host: service.domain, port: String(service.port ?? '') }] : []);
	const [health, setHealth] = useState('http');
	return (
		<>
			<Group title="Port">
				<Field label="Container port" defaultValue={service.port} type="number" mono stage={onStage} kind="networking" className="max-w-40" />
			</Group>
			<Group title="Domains">
				<Toggle
					label="Default domain"
					hint={`${service.name}-${service.id.slice(0, 4)}.apps.acme.dev`}
					defaultChecked={!isDatabase(service.type)}
					stage={onStage}
					kind="networking"
				/>
				<div className="space-y-2">
					{domains.map((d, i) => (
						<div key={i} className="flex items-center gap-2">
							<Input
								defaultValue={d.host}
								placeholder="app.example.com"
								className="h-8 flex-1 font-mono text-xs"
								onChange={() => onStage('networking')}
								aria-label="Domain"
							/>
							<Input
								defaultValue={d.port}
								placeholder="port"
								className="h-8 w-24 font-mono text-xs"
								onChange={() => onStage('networking')}
								aria-label="Target port"
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Remove domain"
								onClick={() => {
									setDomains(ds => ds.filter((_, j) => j !== i));
									onStage('networking');
								}}
							>
								<Trash2Icon />
							</Button>
						</div>
					))}
					<Button variant="outline" size="sm" onClick={() => setDomains(ds => [...ds, { host: '', port: String(service.port ?? '') }])}>
						<PlusIcon /> Add custom domain
					</Button>
				</div>
			</Group>
			<Group title="Public TCP ports" description="Expose raw TCP (databases, game servers) on a port from the cluster pool.">
				<div className="flex items-center gap-2">
					<Input
						placeholder="container port"
						className="h-8 w-36 font-mono text-xs"
						onChange={() => onStage('networking')}
						aria-label="Container port to expose"
					/>
					<span className="text-xs text-muted-foreground">→ public port assigned on deploy</span>
				</div>
			</Group>
			<Group title="Health check">
				<div className="flex gap-2">
					<Select
						value={health}
						onValueChange={v => {
							setHealth(v);
							onStage('networking');
						}}
					>
						<SelectTrigger size="sm" className="w-28">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="http">HTTP</SelectItem>
							<SelectItem value="tcp">TCP</SelectItem>
							<SelectItem value="off">Off</SelectItem>
						</SelectContent>
					</Select>
					{health === 'http' && (
						<Input
							defaultValue="/healthz"
							className="h-8 flex-1 font-mono text-xs"
							onChange={() => onStage('networking')}
							aria-label="Health check path"
						/>
					)}
				</div>
			</Group>
			<Group title="Basic authentication">
				<Toggle label="Protect with a password" hint="Useful for staging and previews." stage={onStage} kind="networking" />
			</Group>
		</>
	);
}

function Resources({ onStage }: { onStage: Stage }) {
	const [autoscale, setAutoscale] = useState(false);
	return (
		<>
			<Group title="Resources" description="Requests are reserved; limits cap usage.">
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="CPU request" defaultValue="100m" mono stage={onStage} kind="resources" />
					<Field label="CPU limit" defaultValue="500m" mono stage={onStage} kind="resources" />
					<Field label="Memory request" defaultValue="128Mi" mono stage={onStage} kind="resources" />
					<Field label="Memory limit" defaultValue="512Mi" mono stage={onStage} kind="resources" />
				</div>
			</Group>
			<Group title="Scaling">
				<div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
					<div>
						<Label htmlFor="autoscale">Autoscaling</Label>
						<p className="mt-0.5 text-xs text-muted-foreground">Scale replicas on CPU and memory usage.</p>
					</div>
					<Switch
						id="autoscale"
						checked={autoscale}
						onCheckedChange={v => {
							setAutoscale(v);
							onStage('scaling');
						}}
					/>
				</div>
				{autoscale ? (
					<div className="grid gap-3 sm:grid-cols-4">
						<Field label="Min" defaultValue="1" type="number" stage={onStage} kind="scaling" />
						<Field label="Max" defaultValue="5" type="number" stage={onStage} kind="scaling" />
						<Field label="Target CPU %" defaultValue="70" type="number" stage={onStage} kind="scaling" />
						<Field label="Target mem %" defaultValue="80" type="number" stage={onStage} kind="scaling" />
					</div>
				) : (
					<Field label="Replicas" defaultValue="2" type="number" stage={onStage} kind="scaling" className="max-w-32" />
				)}
			</Group>
		</>
	);
}

function Volumes({ service, onStage }: { service: Service; onStage: Stage }) {
	const [volumes, setVolumes] = useState(service.volume ? [service.volume] : []);
	return (
		<Group title="Volumes" description="Persistent storage survives restarts and deploys.">
			<div className="space-y-2">
				{volumes.map((v, i) => (
					<div key={i} className="grid grid-cols-[1fr_1.4fr_80px_auto] items-center gap-2">
						<Input
							defaultValue={v.name}
							placeholder="name"
							className="h-8 font-mono text-xs"
							onChange={() => onStage('volumes')}
							aria-label="Volume name"
						/>
						<Input
							defaultValue={v.mountPath}
							placeholder="/data"
							className="h-8 font-mono text-xs"
							onChange={() => onStage('volumes')}
							aria-label="Mount path"
						/>
						<Input defaultValue={v.size} className="h-8 font-mono text-xs" onChange={() => onStage('volumes')} aria-label="Size" />
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Remove volume"
							onClick={() => {
								setVolumes(vs => vs.filter((_, j) => j !== i));
								onStage('volumes');
							}}
						>
							<Trash2Icon />
						</Button>
					</div>
				))}
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						setVolumes(vs => [...vs, { name: `${service.name}-data`, mountPath: '/data', size: '1Gi', usedPct: 0 }]);
						onStage('volumes');
					}}
				>
					<PlusIcon /> Add volume
				</Button>
			</div>
		</Group>
	);
}

function ConfigFiles({ onStage }: { onStage: Stage }) {
	return (
		<Group title="Config files" description="Mounted read-only into the container.">
			<Field label="Path" defaultValue="/usr/local/etc/redis/redis.conf" mono stage={onStage} kind="config files" />
			<Textarea
				defaultValue={'maxmemory 256mb\nmaxmemory-policy allkeys-lru\nappendonly yes'}
				className="min-h-32 font-mono text-xs leading-5"
				spellCheck={false}
				onChange={() => onStage('config files')}
				aria-label="File contents"
			/>
		</Group>
	);
}
