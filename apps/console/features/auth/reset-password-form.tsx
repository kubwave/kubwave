'use client';

import { apiData, apiResult } from '@kubwave/api-client';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import * as z from 'zod';
import { getBrowserApi } from '@/lib/api/browser-api';
import { errorCode } from '@/lib/api/api-error';
import { AuthCard, FormError, FormField, PasswordStrength, SubmitButton } from './auth-kit';
import { InvalidLink } from './invalid-link';

const schema = z
	.object({
		password: z.string().min(8, 'Use at least 8 characters.').max(200, 'Use at most 200 characters.'),
		confirm: z.string()
	})
	.refine(value => value.confirm === value.password, { path: ['confirm'], message: "Passwords don't match." });

const tagline = 'Reset links are single-use and expire after one hour.';

export function ResetPasswordForm({ token }: { token: string }) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	// A transient error (network, rate limit) keeps the form: the POST is the authoritative check.
	const validity = useQuery({
		queryKey: ['auth', 'reset-validity', token],
		queryFn: async () => (await apiResult(getBrowserApi().auth.resetPassword(token).validity.get())).data?.valid ?? true,
		retry: false
	});
	const form = useForm({
		defaultValues: { password: '', confirm: '' },
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				await apiData(getBrowserApi().auth.resetPassword.post({ token, password: value.password }));
				router.replace('/auth/login?reset=1');
			} catch (err) {
				setError(
					errorCode(err) === 'invalid_reset_token'
						? 'This reset link is no longer valid. Request a new one.'
						: 'Something went wrong — please try again.'
				);
			}
		}
	});
	const password = useStore(form.store, state => state.values.password);

	if (validity.isPending)
		return (
			<AuthCard tagline={tagline}>
				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<LoaderCircleIcon className="size-4 animate-spin" />
					Checking your reset link…
				</p>
			</AuthCard>
		);
	if (validity.data === false)
		return (
			<InvalidLink
				title="This link has expired"
				description="The password reset link is invalid or was already used. Request a new one to continue."
				tagline={tagline}
				action={{ href: '/auth/forgot', label: 'Request a new link' }}
			/>
		);

	return (
		<AuthCard title="Choose a new password" description="Choose a new password for your account." tagline={tagline}>
			<form
				noValidate
				onSubmit={event => {
					event.preventDefault();
					void form.handleSubmit();
				}}
				className="grid gap-4"
			>
				<form.Field name="password">
					{field => (
						<FormField
							field={field}
							label="New password"
							type="password"
							autoComplete="new-password"
							autoFocus
							hint={<PasswordStrength value={password} />}
						/>
					)}
				</form.Field>
				<form.Field name="confirm">
					{field => <FormField field={field} label="Confirm password" type="password" autoComplete="new-password" />}
				</form.Field>
				<FormError message={error} />
				<form.Subscribe selector={state => state.isSubmitting}>
					{submitting => (
						<SubmitButton pending={submitting} className="mt-2">
							Update password
						</SubmitButton>
					)}
				</form.Subscribe>
			</form>
		</AuthCard>
	);
}
