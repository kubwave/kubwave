'use client';

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/form-field';
import { serviceErrorMessage } from '@/lib/api/api-error';
import { dockerfileDefaults, dockerfilePayload, dockerfileSchema } from './model';
import { FormStep, FormTextarea, type SourceFormProps } from './parts';
import { useCreateService } from './use-create-service';

const PLACEHOLDER = `FROM nginx:1.27-alpine
RUN echo "<h1>Hello from a built image</h1>" > /usr/share/nginx/html/index.html`;

const code = (text: string) => <code className="font-mono text-foreground">{text}</code>;

export function DockerfileForm({ environmentId, taken, onCreated, onClose }: SourceFormProps) {
	const [error, setError] = useState<string | null>(null);
	const create = useCreateService(environmentId);
	const form = useForm({
		defaultValues: dockerfileDefaults,
		validators: { onSubmit: dockerfileSchema(taken) },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const service = await create.mutateAsync(dockerfilePayload(value));
				toast.success('Service created', { description: service.name });
				onCreated([service]);
				onClose();
			} catch (err) {
				setError(serviceErrorMessage(err, 'Could not create service.'));
			}
		}
	});

	return (
		<form.Subscribe selector={state => state.isSubmitting}>
			{submitting => (
				<FormStep onSubmit={() => void form.handleSubmit()} onCancel={onClose} submitting={submitting} submitLabel="Create service">
					<form.Field name="name">{field => <FormField field={field} label="Name" placeholder="web" autoFocus autoComplete="off" />}</form.Field>
					<form.Field name="dockerfile">
						{field => (
							<FormTextarea
								field={field}
								label="Dockerfile"
								placeholder={PLACEHOLDER}
								className="min-h-44 leading-5"
								hint={
									<>
										The platform builds this Dockerfile and runs the image. No build context is uploaded, so it must be self-contained: {code('COPY')}
										/{code('ADD')} of local files won&apos;t work. Use {code('FROM')}, {code('RUN')}, remote {code('ADD https://…')}, or{' '}
										{code('RUN git clone')}. Set the container port in the service settings after it&apos;s created.
									</>
								}
							/>
						)}
					</form.Field>
					<form.Field name="description">
						{field => <FormField field={field} label="Description" placeholder="Customer-facing web service" />}
					</form.Field>
					<FormError message={error} />
				</FormStep>
			)}
		</form.Subscribe>
	);
}
