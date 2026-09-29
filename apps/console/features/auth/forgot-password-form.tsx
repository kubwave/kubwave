'use client';

import { apiData } from '@kubwave/api-client';
import { useForm } from '@tanstack/react-form';
import { ArrowLeftIcon, MailCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { getBrowserApi } from '@/lib/api/browser-api';
import { AuthCard, AuthNotice, FormError, FormField, SubmitButton } from './auth-kit';

const schema = z.object({ email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.') });

const requestResetLink = (email: string) => apiData(getBrowserApi().auth.forgotPassword.post({ email }));

export function ForgotPasswordForm() {
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { email: '' },
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				await requestResetLink(value.email);
				setSentTo(value.email);
			} catch {
				setError('Could not reach the server — please try again.');
			}
		}
	});

	if (sentTo) {
		return (
			<AuthCard tagline="Reset links expire after one hour.">
				<AuthNotice
					icon={<MailCheckIcon />}
					tone="primary"
					title="Check your inbox"
					description={
						<>
							If an account exists for <span className="font-mono text-foreground">{sentTo}</span>, you&apos;ll receive a link to reset your password.
						</>
					}
				>
					<Button asChild variant="outline">
						<Link href="/auth/login">Back to sign in</Link>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() =>
							requestResetLink(sentTo).then(
								() => toast.success('Reset link sent again', { description: sentTo }),
								() => toast.error('Could not reach the server — please try again.')
							)
						}
					>
						Didn&apos;t get it? Resend
					</Button>
				</AuthNotice>
			</AuthCard>
		);
	}

	return (
		<AuthCard
			title="Reset your password"
			description="Enter the email you sign in with and we'll send you a reset link."
			tagline="Reset links expire after one hour."
			footer={
				<Link href="/auth/login" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
					<ArrowLeftIcon className="size-3.5" />
					Back to sign in
				</Link>
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
				<form.Field name="email">
					{field => <FormField field={field} label="Email" type="email" autoComplete="email" placeholder="you@company.com" autoFocus />}
				</form.Field>
				<FormError message={error} />
				<form.Subscribe selector={state => state.isSubmitting}>
					{submitting => <SubmitButton pending={submitting}>Send reset link</SubmitButton>}
				</form.Subscribe>
			</form>
		</AuthCard>
	);
}
