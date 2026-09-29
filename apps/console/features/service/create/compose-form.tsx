'use client';

import { apiData, type CreateComposeServicesDto } from '@kubwave/api-client';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field as LabeledField } from '@/components/admin/form';
import { FormError } from '@/components/form-field';
import { CodeEditor } from '@/features/service/code-editor';
import { fieldError } from '@/lib/forms';
import { composeErrorMessage, composeSchema } from './model';
import { FormStep, type SourceFormProps } from './parts';
import { environmentApi, useCreateMutation } from './use-create-service';

const PLACEHOLDER = `services:
  web:
    image: ghcr.io/acme/web:latest
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: production
  worker:
    image: ghcr.io/acme/worker:latest`;

export function ComposeForm({ environmentId, onCreated, onClose }: SourceFormProps) {
	const [error, setError] = useState<string | null>(null);
	const create = useCreateMutation(environmentId, (input: CreateComposeServicesDto) => apiData(environmentApi(environmentId).compose.post(input)));
	const form = useForm({
		defaultValues: { compose: '' },
		validators: { onSubmit: composeSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const services = await create.mutateAsync({ compose: value.compose });
				toast.success(`Imported ${services.length} service${services.length === 1 ? '' : 's'}`);
				onCreated(services);
				onClose();
			} catch (err) {
				setError(composeErrorMessage(err));
			}
		}
	});

	return (
		<form.Subscribe selector={state => state.isSubmitting}>
			{submitting => (
				<FormStep onSubmit={() => void form.handleSubmit()} onCancel={onClose} submitting={submitting} submitLabel="Import services">
					<form.Field name="compose">
						{field => (
							<LabeledField
								label="Compose file"
								htmlFor="compose"
								error={fieldError(field.state.meta)}
								hint="Imports each Compose service as a separate Docker image service. Build, networks, and dependencies are ignored. Named volumes are imported; bind mounts are ignored."
							>
								<CodeEditor
									value={field.state.value}
									onChange={value => field.handleChange(value)}
									placeholder={PLACEHOLDER}
									disabled={submitting}
									autoFocus
									aria-label="docker-compose.yml"
									className="h-80"
								/>
							</LabeledField>
						)}
					</form.Field>
					<div className="whitespace-pre-line">
						<FormError message={error} />
					</div>
				</FormStep>
			)}
		</form.Subscribe>
	);
}
