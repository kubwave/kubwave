'use client';

import Link from 'next/link';
import { RuntimeBadge, StatusDot, runtimeStyles } from '@/components/status-badge';
import { projectHref, type Project, type RuntimeStatus, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';

const severity: RuntimeStatus[] = ['failed', 'degraded', 'progressing', 'running', 'stopped', 'unknown'];

export const productionServices = (p: Project) => (p.environments.find(e => e.id === 'production') ?? p.environments[0])?.services ?? [];

export const projectHealth = (p: Project): RuntimeStatus => {
	const statuses = new Set(productionServices(p).map(s => s.status));
	return severity.find(s => statuses.has(s)) ?? 'not_deployed';
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ServiceNames({ services, max = 5 }: { services: Service[]; max?: number }) {
	if (!services.length) return <span className="text-xs text-muted-foreground">No services yet</span>;
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
			{services.slice(0, max).map(s => (
				<span key={s.id} className="inline-flex items-center gap-1.5" title={s.status.replace('_', ' ')}>
					<StatusDot className={cn('size-1.5', runtimeStyles[s.status].dot)} />
					{s.name}
				</span>
			))}
			{services.length > max && <span>+{services.length - max}</span>}
		</span>
	);
}

export function ProjectCard({ project }: { project: Project }) {
	const services = productionServices(project);
	return (
		<Link
			href={projectHref(project.id)}
			className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="flex items-baseline gap-3">
				<h3 className="truncate font-medium">{project.name}</h3>
				<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{project.updatedAgo}</span>
			</div>
			<p className="-mt-2 line-clamp-1 text-sm text-muted-foreground">{project.description || 'No description'}</p>
			<ServiceNames services={services} />
			<div className="mt-auto flex items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
				<RuntimeBadge status={projectHealth(project)} />
				<span className="ml-auto">{plural(project.environments.length, 'environment')}</span>
			</div>
		</Link>
	);
}

export function ProjectList({ projects }: { projects: Project[] }) {
	const cols = 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem_4rem]';
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className={cn('hidden items-center gap-4 border-b px-4 py-2 text-xs text-muted-foreground md:grid', cols)}>
				<span>Project</span>
				<span>Services</span>
				<span>Status</span>
				<span className="text-right">Updated</span>
			</div>
			<ul className="divide-y">
				{projects.map(p => (
					<li key={p.id}>
						<Link
							href={projectHref(p.id)}
							className={cn('grid items-center gap-4 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40', cols)}
						>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium">{p.name}</div>
								<div className="truncate text-xs text-muted-foreground">{p.description || 'No description'}</div>
							</div>
							<span className="hidden min-w-0 md:block">
								<ServiceNames services={productionServices(p)} max={4} />
							</span>
							<RuntimeBadge status={projectHealth(p)} className="hidden md:inline-flex" />
							<span className="text-right text-xs text-muted-foreground tabular-nums">{p.updatedAgo}</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
