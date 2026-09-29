'use client';

import { apiData, type CreateFromTemplateDto, type GeneratedTemplateSecretDto, type TemplateDto } from '@kubwave/api-client';
import { useForm } from '@tanstack/react-form';
import { TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/form-field';
import { CopyField } from '@/components/settings/parts';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { templateDefaults, templateErrorMessage, templatePayload, templateSchema } from './model';
import { FormStep, StepBody, type SourceFormProps } from './parts';
import { environmentApi, useCreateMutation } from './use-create-service';

export function TemplateForm({
	template,
	environmentId,
	taken,
	onCreated,
	onClose,
	onLock
}: SourceFormProps & { template: TemplateDto; onLock: (locked: boolean) => void }) {
	const [error, setError] = useState<string | null>(null);
	const [secrets, setSecrets] = useState<GeneratedTemplateSecretDto[] | null>(null);
	const create = useCreateMutation(environmentId, (input: CreateFromTemplateDto) => apiData(environmentApi(environmentId).fromTemplate.post(input)));
	const form = useForm({
		defaultValues: templateDefaults(template, taken),
		validators: { onSubmit: templateSchema(template, taken) },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const result = await create.mutateAsync(templatePayload(template, value));
				toast.success('Service created', { description: result.services.map(service => service.name).join(', ') });
				onCreated(result.services);
				if (result.generatedSecrets.length === 0) return onClose();
				setSecrets(result.generatedSecrets);
				onLock(true);
			} catch (err) {
				setError(templateErrorMessage(err));
			}
		}
	});

	if (secrets) {
		return (
			<>
				<StepBody>
					<p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
						<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
						Copy these now. They will not be shown again.
					</p>
					{secrets.map(secret => (
						<div key={secret.key} className="grid gap-1.5">
							<Label className="font-mono text-xs text-muted-foreground">{secret.key}</Label>
							<CopyField value={secret.value} label={secret.key} />
						</div>
					))}
				</StepBody>
				<DialogFooter className="border-t bg-muted/40 px-5 py-3">
					<Button
						onClick={() => {
							onLock(false);
							onClose();
						}}
					>
						Continue
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<form.Subscribe selector={state => state.isSubmitting}>
			{submitting => (
				<FormStep onSubmit={() => void form.handleSubmit()} onCancel={onClose} submitting={submitting} submitLabel="Create service">
					<form.Field name="name">{field => <FormField field={field} label="Name" autoFocus autoComplete="off" />}</form.Field>
					{template.inputs.map(input => (
						<form.Field key={input.key} name={`inputs.${input.key}`}>
							{field => (
								<FormField field={field} label={input.required ? input.label : `${input.label} (optional)`} placeholder={input.placeholder} />
							)}
						</form.Field>
					))}
					<FormError message={error} />
				</FormStep>
			)}
		</form.Subscribe>
	);
}
