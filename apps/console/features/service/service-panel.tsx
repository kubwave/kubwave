'use client';

import { ExternalLinkIcon, Maximize2Icon, Minimize2Icon, RocketIcon, SquareIcon, XIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { RuntimeBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Service, ServiceRuntime } from '@/lib/api/types';
import { oneOf, replaceSearchParams } from '@/lib/search-params';
import { SERVICE_TYPE_LABEL, serviceDomain } from '@/lib/service-types';
import { cn } from '@/lib/utils';
import { DeploymentsTab } from './deployments-tab';
import { LogsTab } from './logs-tab';
import { MetricsTab } from './metrics-tab';
import { ServiceIcon } from './service-icon';
import { SettingsTab } from './settings/settings-tab';
import { useServiceDraft, useStagedChanges } from './staged-changes';
import { useServiceDeployments } from './use-deployments';
import { VariablesTab } from './variables-tab';

const PANEL_TABS = ['deployments', 'variables', 'metrics', 'logs', 'settings'] as const;

export function ServicePanel({
	service,
	services,
	runtime,
	onClose,
	onDelete
}: {
	service: Service;
	services: Service[];
	runtime: ServiceRuntime | undefined;
	onClose: () => void;
	onDelete: () => void;
}) {
	const tab = oneOf(useSearchParams().get('tab'), PANEL_TABS, 'deployments');
	const setTab = (next: string) => replaceSearchParams({ tab: next === 'deployments' ? null : next });
	const [expanded, setExpanded] = useState(false);
	const { active, deploy, cancel } = useServiceDeployments(service.id, service.environmentId);
	const { values, update, errors } = useServiceDraft(service);
	// Deploying here would ship the saved config and skip the staged edits the user sees.
	const staged = useStagedChanges().drafts[service.id] !== undefined;
	const domain = serviceDomain(service);
	// Custom domains get TLS; the platform default URL carries its own scheme (plain http on local sslip hosts).
	const domainHref = service.config.domains?.[0]?.host ? `https://${domain}` : (service.defaultUrl ?? `https://${domain}`);
	const port = service.config.containerPort;
	const internal = service.internalDomain ? `${service.internalDomain}${port ? `:${port}` : ''}` : null;
	const isVariable = (path: string) => path.startsWith('env.') || path.startsWith('secrets.');
	const variableErrors = Object.keys(errors).some(isVariable);
	const settingsErrors = Object.keys(errors).some(path => !isVariable(path));

	return (
		<aside
			aria-label={`${service.name} details`}
			className={cn(
				'absolute top-0 right-0 bottom-0 z-20 flex animate-in flex-col overflow-hidden border-l bg-card shadow-xl shadow-black/20 duration-150 slide-in-from-right-4',
				expanded ? 'left-0' : 'w-[min(720px,100%)]'
			)}
		>
			<header className="flex items-start gap-3 px-5 pt-4 pb-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<ServiceIcon type={service.type} className="text-muted-foreground" />
						<h2 className="truncate text-lg font-semibold tracking-tight">{service.name}</h2>
						<span className="text-xs text-muted-foreground">{SERVICE_TYPE_LABEL[service.type]}</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<RuntimeBadge status={runtime?.status ?? 'unknown'} replicas={runtime ? [runtime.readyReplicas, runtime.desiredReplicas] : undefined} />
						{domain && (
							<a href={domainHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-foreground">
								{domain}
								<ExternalLinkIcon className="size-3" />
							</a>
						)}
						{internal && (
							<span className="inline-flex items-center gap-0.5 font-mono">
								{internal}
								<CopyButton value={internal} label="Copy internal address" />
							</span>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{active ? (
						<Button size="sm" variant="outline" disabled={cancel.isPending || active.status === 'canceling'} onClick={() => cancel.mutate(active.id)}>
							<SquareIcon className="fill-current" /> {active.status === 'canceling' ? 'Canceling' : 'Cancel'}
						</Button>
					) : (
						<Button
							size="sm"
							disabled={deploy.isPending || staged}
							title={staged ? 'This service has staged changes: deploy them from the bar at the bottom.' : undefined}
							onClick={() => deploy.mutate()}
						>
							<RocketIcon /> Deploy
						</Button>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setExpanded(value => !value)}
								aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
								className="max-md:hidden"
							>
								{expanded ? <Minimize2Icon /> : <Maximize2Icon />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{expanded ? 'Collapse' : 'Expand'}</TooltipContent>
					</Tooltip>
					<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
						<XIcon />
					</Button>
				</div>
			</header>
			<Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
				<TabsList variant="line" className="w-full justify-start border-b px-4">
					<TabsTrigger value="deployments" className="flex-none">
						Deployments
					</TabsTrigger>
					<TabsTrigger value="variables" className="flex-none">
						Variables <span className="text-xs text-muted-foreground">{values.env.length + values.secrets.length}</span>
						{variableErrors && <ErrorDot />}
					</TabsTrigger>
					<TabsTrigger value="metrics" className="flex-none">
						Metrics
					</TabsTrigger>
					<TabsTrigger value="logs" className="flex-none">
						Logs
					</TabsTrigger>
					<TabsTrigger value="settings" className="flex-none">
						Settings
						{settingsErrors && <ErrorDot />}
					</TabsTrigger>
				</TabsList>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<TabsContent value="deployments" className="p-5">
						<DeploymentsTab service={service} runtime={runtime} onViewLogs={() => setTab('logs')} />
					</TabsContent>
					<TabsContent value="variables" className="p-5">
						<VariablesTab values={values} errors={errors} update={update} services={services} serviceId={service.id} />
					</TabsContent>
					<TabsContent value="metrics" className="p-5">
						<MetricsTab service={service} />
					</TabsContent>
					<TabsContent value="logs" className="flex h-full flex-col p-0">
						<LogsTab service={service} />
					</TabsContent>
					<TabsContent value="settings" className="p-5">
						<SettingsTab service={service} services={services} values={values} errors={errors} update={update} onDelete={onDelete} />
					</TabsContent>
				</div>
			</Tabs>
		</aside>
	);
}

function ErrorDot() {
	return <span className="size-1.5 rounded-full bg-destructive" aria-label="Has errors" />;
}
