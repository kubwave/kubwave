'use client';

import { ArrowLeftIcon, MailCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthCard, AuthNotice, Field, SubmitButton, useFakeSubmit } from '@/components/auth/auth-kit';
import { Button } from '@/components/ui/button';

export default function ForgotPage() {
	const [email, setEmail] = useState('');
	const [sent, setSent] = useState(false);
	const { pending, submit } = useFakeSubmit();

	if (sent) {
		return (
			<AuthCard tagline="Reset links expire after one hour.">
				<AuthNotice
					icon={<MailCheckIcon />}
					tone="primary"
					title="Check your inbox"
					description={
						<>
							If an account exists for <span className="font-mono text-foreground">{email}</span>, you&apos;ll receive a link to reset your password.
						</>
					}
				>
					<Button asChild variant="outline">
						<Link href="/login">Back to sign in</Link>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() => toast.success('Reset link sent again', { description: email })}
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
				<Link href="/login" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
					<ArrowLeftIcon className="size-3.5" />
					Back to sign in
				</Link>
			}
		>
			<form onSubmit={submit(() => setSent(true))} className="grid gap-4">
				<Field
					id="email"
					label="Email"
					type="email"
					autoComplete="email"
					placeholder="you@company.com"
					value={email}
					onChange={e => setEmail(e.target.value)}
					required
					autoFocus
				/>
				<SubmitButton pending={pending}>Send reset link</SubmitButton>
			</form>
		</AuthCard>
	);
}
