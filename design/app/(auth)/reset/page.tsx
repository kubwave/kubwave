'use client';

import { CircleCheckIcon, Link2OffIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard, AuthNotice, Field, PasswordStrength, PreviewToggle, SubmitButton, useFakeSubmit } from '@/components/auth/auth-kit';
import { Button } from '@/components/ui/button';

export default function ResetPage() {
	const [state, setState] = useState<'form' | 'done' | 'invalid'>('form');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const { pending, submit } = useFakeSubmit();
	const mismatch = confirm.length > 0 && confirm !== password;

	const toggle = (
		<PreviewToggle onClick={() => setState(s => (s === 'invalid' ? 'form' : 'invalid'))}>
			{state === 'invalid' ? 'Preview: valid link' : 'Preview: expired link'}
		</PreviewToggle>
	);

	if (state === 'invalid') {
		return (
			<AuthCard tagline="Reset links are single-use and expire after one hour." below={toggle}>
				<AuthNotice
					icon={<Link2OffIcon />}
					tone="destructive"
					title="This link has expired"
					description="The password reset link is invalid or was already used. Request a new one to continue."
				>
					<Button asChild>
						<Link href="/forgot">Request a new link</Link>
					</Button>
					<Button asChild variant="ghost">
						<Link href="/login">Back to sign in</Link>
					</Button>
				</AuthNotice>
			</AuthCard>
		);
	}

	if (state === 'done') {
		return (
			<AuthCard tagline="Other sessions were signed out.">
				<AuthNotice icon={<CircleCheckIcon />} tone="success" title="Password updated" description="You can now sign in with your new password.">
					<Button asChild>
						<Link href="/login">Continue to sign in</Link>
					</Button>
				</AuthNotice>
			</AuthCard>
		);
	}

	return (
		<AuthCard
			title="Choose a new password"
			description={
				<>
					Resetting the password for <span className="font-mono text-foreground">alex@acme.dev</span>.
				</>
			}
			tagline="Reset links are single-use and expire after one hour."
			below={toggle}
		>
			<form onSubmit={submit(() => setState('done'))} className="grid gap-4">
				<Field
					id="password"
					label="New password"
					type="password"
					autoComplete="new-password"
					minLength={8}
					required
					autoFocus
					value={password}
					onChange={e => setPassword(e.target.value)}
					hint={<PasswordStrength value={password} />}
				/>
				<Field
					id="confirm"
					label="Confirm password"
					type="password"
					autoComplete="new-password"
					required
					value={confirm}
					onChange={e => setConfirm(e.target.value)}
					aria-invalid={mismatch}
					aria-describedby={mismatch ? 'confirm-error' : undefined}
					hint={
						mismatch && (
							<p id="confirm-error" className="text-xs text-destructive">
								Passwords don&apos;t match.
							</p>
						)
					}
				/>
				<SubmitButton pending={pending} disabled={mismatch} className="mt-2">
					Update password
				</SubmitButton>
			</form>
		</AuthCard>
	);
}
