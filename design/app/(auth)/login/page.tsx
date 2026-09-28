'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthCard, Field, SubmitButton, useFakeSubmit } from '@/components/auth/auth-kit';
import { currentUser } from '@/lib/mock';

export default function LoginPage() {
	const router = useRouter();
	const { pending, submit } = useFakeSubmit();
	return (
		<AuthCard title="Sign in" footer="No account yet? Ask a team owner for an invite.">
			<form onSubmit={submit(() => router.push('/'))} className="grid gap-4">
				<Field id="email" label="Email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={currentUser.email} required />
				<Field
					id="password"
					label="Password"
					type="password"
					autoComplete="current-password"
					defaultValue="correct-horse-battery"
					required
					aside={
						<Link href="/forgot" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
							Forgot password?
						</Link>
					}
				/>
				<SubmitButton pending={pending} className="mt-2">
					Sign in
				</SubmitButton>
			</form>
		</AuthCard>
	);
}
