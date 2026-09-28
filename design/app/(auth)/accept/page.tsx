'use client';

import { MailXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthCard, AuthNotice, Field, PasswordStrength, PreviewToggle, SubmitButton, useFakeSubmit } from '@/components/auth/auth-kit';
import { TeamAvatar } from '@/components/shell/team-switcher';
import { Button } from '@/components/ui/button';

const invite = { team: 'Acme', invitedBy: 'Sam Rivera', email: 'jordan@acme.dev', role: 'member', members: 6 };

export default function AcceptPage() {
	const router = useRouter();
	const [invalid, setInvalid] = useState(false);
	const [password, setPassword] = useState('');
	const { pending, submit } = useFakeSubmit();

	const toggle = <PreviewToggle onClick={() => setInvalid(v => !v)}>{invalid ? 'Preview: valid invite' : 'Preview: invalid link'}</PreviewToggle>;

	if (invalid) {
		return (
			<AuthCard tagline="Invites expire after seven days." below={toggle}>
				<AuthNotice
					icon={<MailXIcon />}
					tone="destructive"
					title="Invite unavailable"
					description="This invite link is invalid, expired, or has already been used. Ask a team owner to send you a new one."
				>
					<Button asChild variant="outline">
						<Link href="/login">Go to sign in</Link>
					</Button>
				</AuthNotice>
			</AuthCard>
		);
	}

	return (
		<AuthCard
			title="Accept your invite"
			description={
				<>
					<span className="text-foreground">{invite.invitedBy}</span> invited you to join <span className="text-foreground">{invite.team}</span> on
					kubwave.
				</>
			}
			tagline="Invites expire after seven days."
			footer={
				<>
					Already have an account?{' '}
					<Link href="/login" className="text-foreground underline-offset-4 hover:underline">
						Sign in
					</Link>
				</>
			}
			below={toggle}
		>
			<div className="mb-6 flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
				<TeamAvatar name={invite.team} className="size-9 text-sm" />
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium">{invite.team}</div>
					<div className="text-xs text-muted-foreground">
						{invite.members} members · joining as {invite.role}
					</div>
				</div>
			</div>
			<form
				onSubmit={submit(() => {
					toast.success(`Welcome to ${invite.team}`, { description: 'Your account is ready.' });
					router.push('/');
				})}
				className="grid gap-4"
			>
				<Field id="email" label="Email" type="email" value={invite.email} readOnly className="bg-muted/50 font-mono text-muted-foreground" />
				<Field id="name" label="Name" autoComplete="name" placeholder="Jordan Lee" required autoFocus />
				<Field
					id="password"
					label="Password"
					type="password"
					autoComplete="new-password"
					minLength={8}
					required
					value={password}
					onChange={e => setPassword(e.target.value)}
					hint={<PasswordStrength value={password} />}
				/>
				<SubmitButton pending={pending} className="mt-2">
					Join {invite.team}
				</SubmitButton>
			</form>
		</AuthCard>
	);
}
