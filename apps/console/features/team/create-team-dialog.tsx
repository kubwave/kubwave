'use client';

import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import * as z from 'zod';
import { FormField, SubmitButton } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCreateTeam, useSwitchTeam } from './use-teams';

const schema = z.object({ name: z.string().trim().min(1, 'Enter a team name.') });

export function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const createTeam = useCreateTeam();
	const switchTeam = useSwitchTeam();
	const form = useForm({
		defaultValues: { name: '' },
		validators: { onSubmit: schema },
		onSubmit: async ({ value, formApi }) => {
			try {
				const team = await createTeam.mutateAsync(value.name);
				await switchTeam.mutateAsync(team.id);
				toast.success('Team created', { description: `${team.name} is now ready.` });
				formApi.reset();
				onOpenChange(false);
			} catch {
				toast.error('Could not create team', { description: 'Please try again.' });
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
						<DialogTitle>Create team</DialogTitle>
						<DialogDescription>Teams own projects, members, SSH keys and Git connections.</DialogDescription>
					</DialogHeader>
					<form.Field name="name">{field => <FormField field={field} label="Name" placeholder="Acme" autoFocus />}</form.Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<form.Subscribe selector={state => state.isSubmitting}>
							{submitting => (
								<SubmitButton pending={submitting} className="w-auto">
									Create team
								</SubmitButton>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
