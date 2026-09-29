'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { SecretInput, Field as LabeledField } from '@/components/admin/form';
import { FormError, FormField } from '@/components/form-field';
import { serviceErrorMessage } from '@/lib/api/api-error';
import { fieldError } from '@/lib/forms';
import { imageDefaults, imageNameSuggestion, imagePayload, imageSchema } from './model';
import { FormStep, SwitchField, type SourceFormProps } from './parts';
import { useCreateService } from './use-create-service';

export function ImageForm({ environmentId, taken, onCreated, onClose }: SourceFormProps) {
	const [error, setError] = useState<string | null>(null);
	const create = useCreateService(environmentId);
	const form = useForm({
		defaultValues: imageDefaults,
		validators: { onSubmit: imageSchema(taken) },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const service = await create.mutateAsync(imagePayload(value, taken));
				toast.success('Service created', { description: service.name });
				onCreated([service]);
				onClose();
			} catch (err) {
				setError(serviceErrorMessage(err, 'Could not create service.'));
			}
		}
	});

	return (
		<form.Subscribe selector={state => [state.isSubmitting, state.values.imageRef, state.values.registryEnabled] as const}>
			{([submitting, imageRef, registryEnabled]) => (
				<FormStep onSubmit={() => void form.handleSubmit()} onCancel={onClose} submitting={submitting} submitLabel="Create service">
					<form.Field name="imageRef">
						{field => (
							<FormField
								field={field}
								label="Image"
								placeholder="ghcr.io/acme/web:latest"
								className="font-mono text-sm"
								autoFocus
								autoComplete="off"
							/>
						)}
					</form.Field>
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="sm:col-span-2">
							<form.Field name="name">
								{field => <FormField field={field} label="Name" placeholder={imageNameSuggestion(imageRef, taken) || 'web'} autoComplete="off" />}
							</form.Field>
						</div>
						<form.Field name="containerPort">
							{field => <FormField field={field} label="Port" placeholder="none" inputMode="numeric" className="font-mono text-sm" />}
						</form.Field>
					</div>
					<form.Field name="description">
						{field => <FormField field={field} label="Description" placeholder="Customer-facing web service" />}
					</form.Field>
					<form.Field name="registryEnabled">
						{field => (
							<SwitchField field={field} label="Private registry" description="Add credentials if the image is private. You can change them later." />
						)}
					</form.Field>
					{registryEnabled && (
						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field name="registryServer">
								{field => <FormField field={field} label="Registry server" placeholder="ghcr.io" className="font-mono text-sm" />}
							</form.Field>
							<form.Field name="registryUsername">
								{field => <FormField field={field} label="Username" placeholder="octocat" autoComplete="off" />}
							</form.Field>
							<form.Field name="registryPassword">
								{field => (
									<LabeledField label="Password or token" htmlFor="registryPassword" error={fieldError(field.state.meta)} className="sm:col-span-2">
										<SecretInput id="registryPassword" value={field.state.value} onChange={field.handleChange} placeholder="Password or token" />
									</LabeledField>
								)}
							</form.Field>
						</div>
					)}
					<form.Field name="watchEnabled">
						{field => (
							<SwitchField field={field} label="Watch for updates" description="Deploy automatically when a new release of this tag is published." />
						)}
					</form.Field>
					<FormError message={error} />
				</FormStep>
			)}
		</form.Subscribe>
	);
}
