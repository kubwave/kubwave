'use client';

import { apiData } from '@kubwave/api-client';
import { useForm } from '@tanstack/react-form';
import { CircleCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import * as z from 'zod';
import { getBrowserApi } from '@/lib/api/browser-api';
import { errorCode } from '@/lib/api/api-error';
import { AuthCard, FormError, FormField, SubmitButton } from './auth-kit';

const schema = z.object({
	email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.'),
	password: z.string().min(1, 'Enter your password.')
});

export function LoginForm({ redirectTo, justReset }: { redirectTo: string; justReset: boolean }) {
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { email: '', password: '' },
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				await apiData(getBrowserApi().auth.login.post(value));
				// A full load lets the proxy run the setup check and render with the new session.
				window.location.assign(redirectTo);
			} catch (err) {
				setError(errorCode(err) === 'invalid_credentials' ? 'Invalid email or password.' : 'Something went wrong — please try again.');
			}
		}
	});

	return (
		<AuthCard title="Sign in" footer="No account yet? Ask a team owner for an invite.">
			<form
				noValidate
				onSubmit={event => {
					event.preventDefault();
					void form.handleSubmit();
				}}
				className="grid gap-4"
			>
				{justReset && (
					<p className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm">
						<CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
						Your password was updated. Sign in with your new password.
					</p>
				)}
				<form.Field name="email">
					{field => <FormField field={field} label="Email" type="email" autoComplete="email" placeholder="you@company.com" autoFocus />}
				</form.Field>
				<form.Field name="password">
					{field => (
						<FormField
							field={field}
							label="Password"
							type="password"
							autoComplete="current-password"
							aside={
								<Link href="/auth/forgot" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
									Forgot password?
								</Link>
							}
						/>
					)}
				</form.Field>
				<FormError message={error} />
				<form.Subscribe selector={state => state.isSubmitting}>
					{submitting => (
						<SubmitButton pending={submitting} className="mt-2">
							Sign in
						</SubmitButton>
					)}
				</form.Subscribe>
			</form>
		</AuthCard>
	);
}
