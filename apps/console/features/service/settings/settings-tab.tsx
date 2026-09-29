'use client';

import { Trash2Icon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { Service } from '@/lib/api/types';
import { oneOf, replaceSearchParams } from '@/lib/search-params';
import type { ServiceSettingsValues, SettingsErrors } from '@/lib/service-settings';
import { isDatabaseEngine } from '@/lib/service-types';
import { cn } from '@/lib/utils';
import { BuildSection } from './build-section';
import { ConfigFilesSection } from './config-files-section';
import { Group, TextSetting, type SectionProps } from './fields';
import { NetworkingSection } from './networking-section';
import { ResourcesSection, VolumesSection } from './resources-section';
import { SourceSection } from './source-section';

type SectionId = 'general' | 'source' | 'build' | 'networking' | 'resources' | 'volumes' | 'config' | 'danger';

// Top-level value keys edited in each section, so a section can flag its errors. Unlisted keys belong to Source.
const SECTION_KEYS: Partial<Record<SectionId, string[]>> = {
	general: ['name', 'description'],
	build: ['builder', 'dockerfilePath', 'buildCommand', 'startCommand', 'watchPaths', 'watchEntireRepo', 'autoDeploy'],
	networking: ['containerPort', 'defaultDomainEnabled', 'domains', 'exposedPorts', 'healthCheck', 'basicAuth'],
	resources: ['resources', 'autoscaling'],
	volumes: ['volumes'],
	config: ['configFiles']
};

function sectionOf(path: string): SectionId {
	const key = path.split('.')[0]!;
	const match = Object.entries(SECTION_KEYS).find(([, keys]) => keys.includes(key));
	return (match?.[0] as SectionId | undefined) ?? 'source';
}

const isRepo = (type: Service['type']) => ['public-repo', 'private-repo', 'github-repo', 'gitea-repo'].includes(type);

export function SettingsTab({
	service,
	services,
	values,
	errors,
	update,
	onDelete
}: {
	service: Service;
	services: Service[];
	values: ServiceSettingsValues;
	errors: SettingsErrors;
	update: (change: (values: ServiceSettingsValues) => ServiceSettingsValues) => void;
	onDelete: () => void;
}) {
	const database = isDatabaseEngine(service.type);
	const sections: Array<{ id: SectionId; label: string }> = [
		{ id: 'general', label: 'General' },
		{ id: 'source', label: 'Source' },
		...(isRepo(service.type) ? [{ id: 'build' as const, label: 'Build & deploy' }] : []),
		{ id: 'networking', label: 'Networking' },
		{ id: 'resources', label: database ? 'Resources' : 'Resources & scaling' },
		...(database ? [] : [{ id: 'volumes' as const, label: 'Volumes' }]),
		...(service.type === 'docker-image' ? [{ id: 'config' as const, label: 'Config files' }] : []),
		{ id: 'danger', label: 'Danger zone' }
	];
	// The section lives in the URL; one this service type doesn't have (e.g. Build for a database) falls back to Source.
	const active = oneOf(
		useSearchParams().get('section'),
		sections.map(section => section.id),
		'source'
	);
	const setActive = (section: SectionId) => replaceSearchParams({ section: section === 'source' ? null : section });
	const current = sections.find(section => section.id === active)!;
	const flagged = new Set(Object.keys(errors).map(sectionOf));
	const props: SectionProps = { service, values, errors, set: patch => update(current => ({ ...current, ...patch })) };

	return (
		<div className="grid gap-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
			<nav className="flex gap-1 overflow-x-auto sm:sticky sm:top-0 sm:flex-col sm:self-start" aria-label="Service settings">
				{sections.map(section => (
					<button
						key={section.id}
						type="button"
						onClick={() => setActive(section.id)}
						aria-current={active === section.id ? 'page' : undefined}
						className={cn(
							'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground',
							active === section.id && 'bg-accent font-medium text-foreground',
							section.id === 'danger' && 'sm:mt-4'
						)}
					>
						{section.label}
						{flagged.has(section.id) && <span className="ml-auto size-1.5 rounded-full bg-destructive" aria-label="Has errors" />}
					</button>
				))}
			</nav>
			{/* A container, not the viewport, decides the field columns: the panel is narrow even on wide screens. */}
			<div className="@container min-w-0 max-w-3xl">
				<h3 className="mb-4 text-base font-semibold">{current.label}</h3>
				<div className="space-y-6">
					{active === 'general' && (
						<Group>
							<TextSetting label="Name" value={values.name} onValueChange={name => props.set({ name })} error={errors.name} />
							<TextSetting label="Description" value={values.description} onValueChange={description => props.set({ description })} />
						</Group>
					)}
					{active === 'source' && <SourceSection {...props} />}
					{active === 'build' && <BuildSection {...props} />}
					{active === 'networking' && <NetworkingSection {...props} />}
					{active === 'resources' && <ResourcesSection {...props} />}
					{active === 'volumes' && <VolumesSection {...props} />}
					{active === 'config' && <ConfigFilesSection {...props} services={services.filter(other => other.id !== service.id)} />}
					{active === 'danger' && (
						<div className="flex flex-col gap-3 rounded-md border border-destructive/30 p-4 @md:flex-row @md:items-center @md:justify-between">
							<div>
								<p className="text-sm font-medium">Delete {service.name}</p>
								<p className="text-xs text-muted-foreground">
									Removes the workload, its domains, volumes and deployment history. This cannot be undone.
								</p>
							</div>
							<Button variant="destructive" size="sm" className="w-fit shrink-0" onClick={onDelete}>
								<Trash2Icon /> Delete service
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
