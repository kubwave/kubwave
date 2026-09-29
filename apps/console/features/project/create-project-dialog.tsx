'use client';

import { useForm } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { FormError, FormField, SubmitButton } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorCode } from '@/lib/api/api-error';
import { projectHref } from '@/lib/routes';
import { useCreateProject } from './use-project';

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a project name.').max(48, 'Use at most 48 characters.'),
	description: z.string().trim().max(200, 'Use at most 200 characters.')
});

function createErrorMessage(err: unknown): string {
	switch (errorCode(err)) {
		case 'project_name_taken':
			return 'A project with that name already exists in this team.';
		case 'team_not_found':
			return 'This team is no longer available to you.';
		default:
			return 'Could not create project. Please try again.';
	}
}

export function CreateProjectDialog({ teamId, open, onOpenChange }: { teamId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
	const router = useRouter();
	const createProject = useCreateProject(teamId);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { name: '', description: '' },
		validators: { onSubmit: schema },
		onSubmit: async ({ value, formApi }) => {
			setError(null);
			try {
				const project = await createProject.mutateAsync({ name: value.name.trim(), description: value.description.trim() || undefined });
				toast.success('Project created', { description: `${project.name} is ready.` });
				formApi.reset();
				onOpenChange(false);
				router.push(projectHref(project.id));
			} catch (err) {
				setError(createErrorMessage(err));
			}
		}
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<form
					noValidate
					onSubmit={event => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="grid gap-4"
				>
					<DialogHeader>
						<DialogTitle>New project</DialogTitle>
						<DialogDescription>A project groups services and their environments.</DialogDescription>
					</DialogHeader>
					<form.Field name="name">{field => <FormField field={field} label="Name" placeholder="storefront" autoFocus />}</form.Field>
					<form.Field name="description">{field => <FormField field={field} label="Description" placeholder="Optional" />}</form.Field>
					<FormError message={error} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<form.Subscribe selector={state => state.isSubmitting}>
							{submitting => (
								<SubmitButton pending={submitting} className="w-auto">
									Create project
								</SubmitButton>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
