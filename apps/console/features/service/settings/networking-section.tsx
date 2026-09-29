'use client';

import { AlertTriangleIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { rowId, type ServiceSettingsValues } from '@/lib/service-settings';
import { isDatabaseEngine } from '@/lib/service-types';
import { cn } from '@/lib/utils';
import { FieldError, Group, RemoveRowButton, replaceAt, TextSetting, ToggleSetting, type SectionProps } from './fields';

type HealthTiming = 'initialDelaySeconds' | 'periodSeconds' | 'timeoutSeconds' | 'failureThreshold' | 'successThreshold';

const HEALTH_TIMINGS: Array<{ key: HealthTiming; label: string; placeholder: string }> = [
	{ key: 'initialDelaySeconds', label: 'Initial delay (s)', placeholder: '0' },
	{ key: 'periodSeconds', label: 'Period (s)', placeholder: '10' },
	{ key: 'timeoutSeconds', label: 'Timeout (s)', placeholder: '3' },
	{ key: 'failureThreshold', label: 'Failures', placeholder: '3' },
	{ key: 'successThreshold', label: 'Successes', placeholder: '1' }
];

const DOMAIN_ROW = 'grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] items-center gap-2';

export function NetworkingSection(props: SectionProps) {
	if (isDatabaseEngine(props.service.type)) return <TcpPorts {...props} />;
	const { service, values, errors, set } = props;
	const port = values.containerPort.trim();
	return (
		<>
			<Group>
				<TextSetting
					label="Container port"
					value={values.containerPort}
					onValueChange={containerPort => set({ containerPort })}
					error={errors.containerPort}
					inputMode="numeric"
					placeholder="3000"
					mono
					className="max-w-40"
				/>
			</Group>
			<Group title="Domains">
				<ToggleSetting
					label="Default domain"
					hint={port ? (service.defaultUrl ?? 'Generate a public platform URL for this service.') : 'Set a container port first.'}
					checked={values.defaultDomainEnabled && Boolean(port)}
					disabled={!port}
					onCheckedChange={defaultDomainEnabled => set({ defaultDomainEnabled })}
				/>
				<div className="space-y-2">
					{values.domains.length > 0 && (
						<div className={cn(DOMAIN_ROW, 'text-xs text-muted-foreground')}>
							<span>Custom domain</span>
							<span>Port</span>
						</div>
					)}
					{values.domains.map((domain, index) => (
						<div key={domain._id} className="space-y-1">
							<div className={DOMAIN_ROW}>
								<Input
									value={domain.host}
									onChange={event => set({ domains: replaceAt(values.domains, index, { host: event.target.value }) })}
									placeholder="app.example.com"
									className="h-8 font-mono text-xs"
									aria-label="Domain"
									aria-invalid={errors[`domains.${index}.host`] ? true : undefined}
								/>
								<Input
									value={domain.port}
									onChange={event => set({ domains: replaceAt(values.domains, index, { port: event.target.value }) })}
									inputMode="numeric"
									placeholder="80"
									className="h-8 font-mono text-xs"
									aria-label="Target port"
									aria-invalid={errors[`domains.${index}.port`] ? true : undefined}
								/>
								<RemoveRowButton label="Remove domain" onClick={() => set({ domains: values.domains.filter((_, i) => i !== index) })} />
							</div>
							<FieldError message={errors[`domains.${index}.host`] ?? errors[`domains.${index}.port`]} />
						</div>
					))}
					<Button
						variant="outline"
						size="sm"
						className="w-fit"
						onClick={() => set({ domains: [...values.domains, { _id: rowId(), host: '', port: port || '80' }] })}
					>
						<PlusIcon /> Add custom domain
					</Button>
				</div>
			</Group>
			<TcpPorts {...props} />
			<HealthCheck values={values} errors={errors} set={set} />
			<BasicAuth values={values} errors={errors} set={set} />
		</>
	);
}

function TcpPorts({ service, values, errors, set }: SectionProps) {
	return (
		<Group
			title="Public TCP ports"
			description="Expose a container port on the platform's public IP, e.g. to reach a database from your machine. The public port is assigned on save."
		>
			{values.exposedPorts.length > 0 && (
				<div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
					<AlertTriangleIcon className="size-4 shrink-0 text-warning" />
					<span className="text-muted-foreground">
						Exposed ports are reachable by anyone without extra authentication. Open them only while you need them.
					</span>
				</div>
			)}
			{values.exposedPorts.map((exposure, index) => {
				const endpoint = service.exposedEndpoints.find(item => String(item.containerPort) === exposure.containerPort.trim());
				const address = endpoint?.host ? `${endpoint.host}:${endpoint.publicPort}` : null;
				return (
					<div key={exposure._id} className="space-y-1">
						<div className="flex items-center gap-2">
							<Input
								value={exposure.containerPort}
								onChange={event => set({ exposedPorts: replaceAt(values.exposedPorts, index, { containerPort: event.target.value }) })}
								inputMode="numeric"
								placeholder={values.containerPort || '5432'}
								className="h-8 w-32 font-mono text-xs"
								aria-label="Container port to expose"
								aria-invalid={errors[`exposedPorts.${index}.containerPort`] ? true : undefined}
							/>
							<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
								→ {address ?? (exposure.publicPort || 'assigned on save')}
							</span>
							{address && <CopyButton value={address} label="Copy public address" />}
							<RemoveRowButton label="Remove exposed port" onClick={() => set({ exposedPorts: values.exposedPorts.filter((_, i) => i !== index) })} />
						</div>
						<FieldError message={errors[`exposedPorts.${index}.containerPort`]} />
					</div>
				);
			})}
			<Button
				variant="outline"
				size="sm"
				className="w-fit"
				onClick={() => set({ exposedPorts: [...values.exposedPorts, { _id: rowId(), containerPort: '', publicPort: '' }] })}
			>
				<PlusIcon /> Expose a port
			</Button>
		</Group>
	);
}

type PartProps = Pick<SectionProps, 'values' | 'errors' | 'set'>;

function HealthCheck({ values, errors, set }: PartProps) {
	const hc = values.healthCheck;
	const patch = (change: Partial<ServiceSettingsValues['healthCheck']>) => set({ healthCheck: { ...hc, ...change } });
	return (
		<Group title="Health check" description="Kubernetes liveness and readiness probes for the container.">
			<ToggleSetting label="Probe the container" checked={hc.enabled} onCheckedChange={enabled => patch({ enabled })} />
			{hc.enabled && (
				<>
					<div className={cn('grid gap-3', hc.type === 'http' ? '@md:grid-cols-[7rem_minmax(0,1fr)_7rem]' : '@md:grid-cols-[7rem_7rem]')}>
						<div className="space-y-1.5">
							<Label className="text-xs">Type</Label>
							<Select value={hc.type} onValueChange={type => patch({ type: type as 'http' | 'tcp' })}>
								<SelectTrigger size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="http">HTTP</SelectItem>
									<SelectItem value="tcp">TCP</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{hc.type === 'http' && (
							<TextSetting
								label="Path"
								value={hc.path}
								onValueChange={path => patch({ path })}
								error={errors['healthCheck.path']}
								mono
								placeholder="/health"
							/>
						)}
						<TextSetting
							label="Port"
							value={hc.port}
							onValueChange={port => patch({ port })}
							inputMode="numeric"
							mono
							placeholder={values.containerPort || '3000'}
						/>
					</div>
					<Collapsible>
						<CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
							<ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
							Timings
						</CollapsibleTrigger>
						<CollapsibleContent className="grid grid-cols-2 gap-3 pt-3 @lg:grid-cols-3 @2xl:grid-cols-5">
							{HEALTH_TIMINGS.map(timing => (
								<TextSetting
									key={timing.key}
									label={timing.label}
									value={hc[timing.key]}
									onValueChange={value => patch({ [timing.key]: value })}
									inputMode="numeric"
									placeholder={timing.placeholder}
									mono
								/>
							))}
						</CollapsibleContent>
					</Collapsible>
				</>
			)}
		</Group>
	);
}

function BasicAuth({ values, errors, set }: PartProps) {
	const auth = values.basicAuth;
	const patch = (change: Partial<ServiceSettingsValues['basicAuth']>) => set({ basicAuth: { ...auth, ...change } });
	return (
		<Group title="Basic authentication">
			<ToggleSetting
				label="Protect with a password"
				hint="Guards every domain of this service. Useful for staging and previews."
				checked={auth.enabled}
				onCheckedChange={enabled => patch({ enabled })}
			/>
			{auth.enabled && (
				<>
					<div className="grid gap-3 @md:grid-cols-2">
						<TextSetting
							label="Username"
							value={auth.username}
							onValueChange={username => patch({ username })}
							error={errors['basicAuth.username']}
							placeholder="admin"
						/>
						<TextSetting
							label="Password"
							type="password"
							autoComplete="new-password"
							value={auth.password}
							onValueChange={password => patch({ password })}
							error={errors['basicAuth.password']}
							placeholder={auth.hasPassword ? 'Stored — type to replace' : undefined}
						/>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs">Public paths</Label>
						<Textarea
							value={auth.publicPaths}
							onChange={event => patch({ publicPaths: event.target.value })}
							className="min-h-20 font-mono text-xs"
							placeholder={'/health\n/api/*'}
							spellCheck={false}
							aria-invalid={errors['basicAuth.publicPaths'] ? true : undefined}
						/>
						{errors['basicAuth.publicPaths'] ? (
							<FieldError message={errors['basicAuth.publicPaths']} />
						) : (
							<p className="text-[11px] text-muted-foreground">One path per line that skips the password. /api/* includes all sub-paths.</p>
						)}
					</div>
				</>
			)}
		</Group>
	);
}
