import type { Metadata } from 'next';
import { AcceptInviteForm } from '@/features/auth/accept-invite-form';
import { InvalidLink } from '@/features/auth/invalid-link';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Accept your invite' };

export default async function AcceptPage({ searchParams }: PageProps<'/auth/accept'>) {
	const token = firstParam((await searchParams).token);
	if (!token)
		return (
			<InvalidLink
				title="Invalid invite link"
				description="This link is missing its token. Ask an admin to resend the invite."
				tagline="Invites expire after seven days."
				action={{ href: '/auth/login', label: 'Back to sign in' }}
			/>
		);
	return <AcceptInviteForm token={token} />;
}
