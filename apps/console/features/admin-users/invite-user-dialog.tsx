'use client';

import { useForm } from '@tanstack/react-form';
import { SendIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { FormError, FormField, SubmitButton } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { errorCode } from '@/lib/api/api-error';
import { useInviteUser } from './use-admin-users';

const schema = z.object({
	email: z.string().trim().min(1, 'Enter an email.').email('Enter a valid email address.'),
	isAdmin: z.boolean()
});

export function InviteUserDialog({ open, onOpenChange, onInvited }: { open: boolean; onOpenChange: (open: boolean) => void; onInvited: () => void }) {
	const invite = useInviteUser();
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { email: '', isAdmin: false },
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			setError(null);
			const email = value.email.trim();
			try {
				const result = await invite.mutateAsync({ email, isAdmin: value.isAdmin });
				if (result.emailSent) toast.success('Invitation sent', { description: `An invite email was sent to ${email}.` });
				else
					toast.warning('Invitation created — email not sent', {
						description: `${result.emailError ?? 'SMTP error'}. Configure SMTP in Settings, then resend.`
					});
				close();
				onInvited();
			} catch (err) {
				setError(errorCode(err) === 'email_in_use' ? 'A user with this email already exists.' : 'Could not create invitation. Please try again.');
			}
		}
	});

	function close() {
		form.reset();
		setError(null);
		onOpenChange(false);
	}

	return (
		<Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
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
						<DialogTitle>Invite user</DialogTitle>
						<DialogDescription>They get an email with a sign-up link. Team membership is managed per team.</DialogDescription>
					</DialogHeader>
					<form.Field name="email">
						{field => <FormField field={field} label="Email" type="email" placeholder="name@company.com" autoComplete="off" autoFocus />}
					</form.Field>
					<form.Field name="isAdmin">
						{field => (
							<label htmlFor="invite-admin" className="flex items-start justify-between gap-4 rounded-md border p-3">
								<span className="space-y-0.5">
									<span className="block text-sm font-medium">Grant admin access</span>
									<span className="block text-xs text-muted-foreground">Admins can manage users, settings, and platform updates.</span>
								</span>
								<Switch id="invite-admin" checked={field.state.value} onCheckedChange={field.handleChange} />
							</label>
						)}
					</form.Field>
					<FormError message={error} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={close}>
							Cancel
						</Button>
						<form.Subscribe selector={state => state.isSubmitting}>
							{submitting => (
								<SubmitButton pending={submitting} className="w-auto">
									{!submitting && <SendIcon />}
									Send invitation
								</SubmitButton>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
