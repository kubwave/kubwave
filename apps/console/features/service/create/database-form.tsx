'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/form-field';
import { SelectItem } from '@/components/ui/select';
import { serviceErrorMessage } from '@/lib/api/api-error';
import { DATABASE_ENGINE_UI, type DatabaseEngine } from '@/lib/service-types';
import { databaseDefaults, databasePayload, databaseSchema } from './model';
import { Advanced, FormSelect, FormStep, type SourceFormProps } from './parts';
import { useCreateService } from './use-create-service';

export function DatabaseForm({ engine, environmentId, taken, onCreated, onClose }: SourceFormProps & { engine: DatabaseEngine }) {
	const ui = DATABASE_ENGINE_UI[engine];
	const [error, setError] = useState<string | null>(null);
	const create = useCreateService(environmentId);
	const form = useForm({
		defaultValues: databaseDefaults(engine, taken),
		validators: { onSubmit: databaseSchema(taken) },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const service = await create.mutateAsync(databasePayload(engine, value));
				toast.success(`${ui.label} created`, { description: service.name });
				onCreated([service]);
				onClose();
			} catch (err) {
				setError(serviceErrorMessage(err, 'Could not create database.'));
			}
		}
	});

	return (
		<form.Subscribe selector={state => state.isSubmitting}>
			{submitting => (
				<FormStep onSubmit={() => void form.handleSubmit()} onCancel={onClose} submitting={submitting} submitLabel="Create database">
					<div className="grid gap-4 sm:grid-cols-5">
						<div className="sm:col-span-3">
							<form.Field name="name">{field => <FormField field={field} label="Name" placeholder="db" autoFocus autoComplete="off" />}</form.Field>
						</div>
						<form.Field name="version">
							{field => (
								<FormSelect field={field} label="Version" placeholder="Pick a version" className="sm:col-span-2">
									{ui.versions.map(version => (
										<SelectItem key={version} value={version}>
											{ui.label} {version}
										</SelectItem>
									))}
								</FormSelect>
							)}
						</form.Field>
					</div>
					<form.Field name="description">{field => <FormField field={field} label="Description" placeholder="Primary database" />}</form.Field>
					<Advanced>
						<form.Field name="database">{field => <FormField field={field} label="Database name" placeholder="app" autoComplete="off" />}</form.Field>
						<form.Field name="username">{field => <FormField field={field} label="Username" placeholder="app" autoComplete="off" />}</form.Field>
						<form.Field name="storage">
							{field => <FormField field={field} label="Storage" placeholder="1Gi" className="font-mono text-sm" />}
						</form.Field>
						<p className="text-xs text-muted-foreground sm:col-span-2">
							Defaults to user <code className="font-mono">app</code>, database <code className="font-mono">app</code>, and 1Gi of storage. A strong
							password is generated automatically; find the connection details in the service settings.
						</p>
					</Advanced>
					<FormError message={error} />
				</FormStep>
			)}
		</form.Subscribe>
	);
}
