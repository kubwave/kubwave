'use client';

import { ExternalLinkIcon, Maximize2Icon, Minimize2Icon, RocketIcon, SquareIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { RuntimeBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { serviceTypeLabel, type Deployment, type EnvVar, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';
import { DeploymentsTab } from './deployments-tab';
import { LogsTab } from './logs-tab';
import { MetricsTab } from './metrics-tab';
import { ServiceIcon } from './service-icon';
import { SettingsTab } from './settings-tab';
import { VariablesTab } from './variables-tab';

export function ServicePanel({
	service,
	services,
	deployments,
	vars,
	expanded,
	onToggleExpand,
	onClose,
	onDeploy,
	onCancel,
	onVarsChange,
	onStage,
	onDelete
}: {
	service: Service;
	services: Service[];
	deployments: Deployment[];
	vars: EnvVar[];
	expanded: boolean;
	onToggleExpand: () => void;
	onClose: () => void;
	onDeploy: () => void;
	onCancel: () => void;
	onVarsChange: (vars: EnvVar[]) => void;
	onStage: (kind: string) => void;
	onDelete: () => void;
}) {
	const [tab, setTab] = useState('deployments');
	const busy = deployments[0] && ['pending', 'deploying', 'canceling'].includes(deployments[0].status);

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
						<span className="text-xs text-muted-foreground">{serviceTypeLabel[service.type]}</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<RuntimeBadge status={service.status} replicas={service.replicas} />
						{service.domain && (
							<a
								href={`https://${service.domain}`}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 font-mono hover:text-foreground"
							>
								{service.domain}
								<ExternalLinkIcon className="size-3" />
							</a>
						)}
						<span className="inline-flex items-center gap-0.5 font-mono">
							{service.internalHost}
							{service.port && `:${service.port}`}
							<CopyButton value={`${service.internalHost}${service.port ? `:${service.port}` : ''}`} label="Copy internal address" />
						</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{busy ? (
						<Button size="sm" variant="outline" onClick={onCancel}>
							<SquareIcon className="fill-current" /> Cancel
						</Button>
					) : (
						<Button size="sm" onClick={onDeploy}>
							<RocketIcon /> Deploy
						</Button>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onToggleExpand}
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
						Variables <span className="text-xs text-muted-foreground">{vars.length}</span>
					</TabsTrigger>
					<TabsTrigger value="metrics" className="flex-none">
						Metrics
					</TabsTrigger>
					<TabsTrigger value="logs" className="flex-none">
						Logs
					</TabsTrigger>
					<TabsTrigger value="settings" className="flex-none">
						Settings
					</TabsTrigger>
				</TabsList>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<TabsContent value="deployments" className="p-5">
						<DeploymentsTab service={service} deployments={deployments} onDeploy={onDeploy} onCancel={onCancel} onViewLogs={() => setTab('logs')} />
					</TabsContent>
					<TabsContent value="variables" className="p-5">
						<VariablesTab service={service} services={services} vars={vars} onChange={onVarsChange} />
					</TabsContent>
					<TabsContent value="metrics" className="p-5">
						<MetricsTab service={service} />
					</TabsContent>
					<TabsContent value="logs" className="flex h-full flex-col p-0">
						<LogsTab service={service} />
					</TabsContent>
					<TabsContent value="settings" className="p-5">
						<SettingsTab service={service} onStage={onStage} onDelete={onDelete} />
					</TabsContent>
				</div>
			</Tabs>
		</aside>
	);
}
