'use client';

import { HardDriveIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rowId, type ServiceSettingsValues } from '@/lib/service-settings';
import { isDatabaseEngine } from '@/lib/service-types';
import { cn } from '@/lib/utils';
import { FieldError, Group, RemoveRowButton, replaceAt, TextSetting, ToggleSetting, type SectionProps } from './fields';

const QUANTITIES: Array<{ key: keyof ServiceSettingsValues['resources']; label: string; placeholder: string }> = [
	{ key: 'cpuRequest', label: 'CPU request', placeholder: '250m' },
	{ key: 'cpuLimit', label: 'CPU limit', placeholder: '500m' },
	{ key: 'memoryRequest', label: 'Memory request', placeholder: '256Mi' },
	{ key: 'memoryLimit', label: 'Memory limit', placeholder: '512Mi' }
];

const TARGETS: Array<{ key: keyof ServiceSettingsValues['autoscaling']; label: string; placeholder: string }> = [
	{ key: 'minReplicas', label: 'Min replicas', placeholder: '1' },
	{ key: 'maxReplicas', label: 'Max replicas', placeholder: '3' },
	{ key: 'targetCpuUtilizationPercentage', label: 'Target CPU %', placeholder: '70' },
	{ key: 'targetMemoryUtilizationPercentage', label: 'Target memory %', placeholder: '80' }
];

const VOLUME_ROW = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5rem_2rem] items-center gap-x-2';

export function ResourcesSection({ service, values, errors, set }: SectionProps) {
	const scaling = values.autoscaling;
	const pinned = values.volumes.length > 0;
	return (
		<>
			<Group description="Requests are reserved; limits cap usage. Leave blank for no constraint.">
				<div className="grid gap-3 @md:grid-cols-2">
					{QUANTITIES.map(quantity => (
						<TextSetting
							key={quantity.key}
							label={quantity.label}
							value={values.resources[quantity.key]}
							onValueChange={value => set({ resources: { ...values.resources, [quantity.key]: value } })}
							error={errors[`resources.${quantity.key}`]}
							placeholder={quantity.placeholder}
							mono
						/>
					))}
				</div>
			</Group>
			{!isDatabaseEngine(service.type) && (
				<Group title="Scaling">
					<ToggleSetting
						label="Autoscaling"
						hint={
							pinned && !scaling.enabled
								? 'Unavailable: a volume pins this service to one instance.'
								: 'Scale replicas on CPU and memory usage. Needs a matching request above. Off runs one replica.'
						}
						checked={scaling.enabled}
						disabled={pinned && !scaling.enabled}
						onCheckedChange={enabled => set({ autoscaling: { ...scaling, enabled } })}
						error={errors['autoscaling.enabled']}
					/>
					{scaling.enabled && (
						<div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
							{TARGETS.map(target => (
								<TextSetting
									key={target.key}
									label={target.label}
									value={String(scaling[target.key])}
									onValueChange={value => set({ autoscaling: { ...scaling, [target.key]: value } })}
									error={errors[`autoscaling.${target.key}`]}
									inputMode="numeric"
									placeholder={target.placeholder}
								/>
							))}
						</div>
					)}
				</Group>
			)}
		</>
	);
}

export function VolumesSection({ service, values, errors, set }: SectionProps) {
	const original = new Set((service.config.volumes ?? []).map(volume => volume.name));
	return (
		<Group description="Persistent storage survives restarts and deploys. A volume pins the service to one instance and can only grow.">
			{values.autoscaling.enabled && <p className="text-sm text-muted-foreground">Disable autoscaling to add a volume.</p>}
			{values.volumes.length > 0 && (
				<div className={cn(VOLUME_ROW, 'text-xs text-muted-foreground')}>
					<span>Name</span>
					<span>Mount path</span>
					<span>Size</span>
				</div>
			)}
			{values.volumes.map((volume, index) => {
				const patch = (change: Partial<(typeof values.volumes)[number]>) => set({ volumes: replaceAt(values.volumes, index, change) });
				const fieldError = (field: 'name' | 'mountPath' | 'size' | 'subPath') => errors[`volumes.${index}.${field}`];
				const rowError = fieldError('name') ?? fieldError('mountPath') ?? fieldError('size') ?? fieldError('subPath');
				const invalid = (field: 'name' | 'mountPath' | 'size' | 'subPath') => (fieldError(field) ? true : undefined);
				return (
					<div key={volume._id} className={cn(VOLUME_ROW, 'gap-y-1.5')}>
						<div className="relative">
							<HardDriveIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={volume.name}
								onChange={event => patch({ name: event.target.value })}
								readOnly={original.has(volume.name)}
								placeholder="data"
								className="h-8 pl-8 font-mono text-xs"
								aria-label="Volume name"
								aria-invalid={invalid('name')}
							/>
						</div>
						<Input
							value={volume.mountPath}
							onChange={event => patch({ mountPath: event.target.value })}
							placeholder="/data"
							className="h-8 font-mono text-xs"
							aria-label="Mount path"
							aria-invalid={invalid('mountPath')}
						/>
						<Input
							value={volume.size}
							onChange={event => patch({ size: event.target.value })}
							placeholder="1Gi"
							className="h-8 font-mono text-xs"
							aria-label="Size"
							aria-invalid={invalid('size')}
						/>
						<RemoveRowButton label={`Remove volume ${volume.name}`} onClick={() => set({ volumes: values.volumes.filter((_, i) => i !== index) })} />
						<span className="text-right text-xs text-muted-foreground" title="Mount a subdirectory of the volume instead of its root">
							subPath
						</span>
						<Input
							value={volume.subPath}
							onChange={event => patch({ subPath: event.target.value })}
							placeholder="optional, e.g. pgdata"
							className="col-span-2 h-7 font-mono text-xs"
							aria-label="Volume subPath"
							aria-invalid={invalid('subPath')}
						/>
						{rowError && (
							<div className="col-span-4">
								<FieldError message={rowError} />
							</div>
						)}
					</div>
				);
			})}
			<Button
				variant="outline"
				size="sm"
				className="w-fit"
				disabled={values.autoscaling.enabled}
				onClick={() =>
					set({ volumes: [...values.volumes, { _id: rowId(), name: `${service.name}-data`, mountPath: '/data', size: '1Gi', subPath: '' }] })
				}
			>
				<PlusIcon /> Add volume
			</Button>
		</Group>
	);
}
