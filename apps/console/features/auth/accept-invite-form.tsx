'use client';

import { apiData, apiResult } from '@kubwave/api-client';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import * as z from 'zod';
import { getBrowserApi } from '@/lib/api/browser-api';
import { errorCode } from '@/lib/api/api-error';
import { AuthCard, Field, FormError, FormField, PasswordStrength, SubmitButton } from './auth-kit';
import { InvalidLink } from './invalid-link';

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a name.'),
	password: z.string().min(8, 'Use at least 8 characters.')
});

const tagline = 'Invites expire after seven days.';

function InviteUnavailable() {
	return (
		<InvalidLink
			title="Invite unavailable"
			description="This invite link is invalid, expired, or has already been used. Ask an admin to send you a new one."
			tagline={tagline}
			action={{ href: '/auth/login', label: 'Go to sign in' }}
		/>
	);
}

export function AcceptInviteForm({ token }: { token: string }) {
	const [error, setError] = useState<string | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	// A transient error keeps the form: accepting is the authoritative check.
	const invite = useQuery({
		queryKey: ['invitations', token, 'validity'],
		queryFn: async () => (await apiResult(getBrowserApi().invitations(token).validity.get())).data ?? { valid: true },
		retry: false
	});
	const form = useForm({
		defaultValues: { name: '', password: '' },
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				await apiData(getBrowserApi().invitations(token).accept.post(value));
				window.location.assign('/');
			} catch (err) {
				if (errorCode(err) === 'invite_not_found') setUnavailable(true);
				else setError('Something went wrong — please try again.');
			}
		}
	});
	const password = useStore(form.store, state => state.values.password);

	if (invite.isPending)
		return (
			<AuthCard tagline={tagline}>
				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<LoaderCircleIcon className="size-4 animate-spin" />
					Checking your invite…
				</p>
			</AuthCard>
		);
	if (unavailable || invite.data?.valid === false) return <InviteUnavailable />;

	return (
		<AuthCard
			title="Accept your invite"
			description="Choose a name and password to join kubwave."
			tagline={tagline}
			footer={
				<>
					Already have an account?{' '}
					<Link href="/auth/login" className="text-foreground underline-offset-4 hover:underline">
						Sign in
					</Link>
				</>
			}
		>
			<form
				noValidate
				onSubmit={event => {
					event.preventDefault();
					void form.handleSubmit();
				}}
				className="grid gap-4"
			>
				{invite.data?.email && <Field id="email" label="Email" type="email" value={invite.data.email} readOnly disabled />}
				<form.Field name="name">
					{field => <FormField field={field} label="Name" autoComplete="name" placeholder="Jordan Lee" autoFocus />}
				</form.Field>
				<form.Field name="password">
					{field => (
						<FormField field={field} label="Password" type="password" autoComplete="new-password" hint={<PasswordStrength value={password} />} />
					)}
				</form.Field>
				<FormError message={error} />
				<form.Subscribe selector={state => state.isSubmitting}>
					{submitting => (
						<SubmitButton pending={submitting} className="mt-2">
							Accept invite
						</SubmitButton>
					)}
				</form.Subscribe>
			</form>
		</AuthCard>
	);
}
