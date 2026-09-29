import type { Metadata } from 'next';
import { InvalidLink } from '@/features/auth/invalid-link';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPage({ searchParams }: PageProps<'/auth/reset'>) {
	const token = firstParam((await searchParams).token);
	if (!token)
		return (
			<InvalidLink
				title="Invalid reset link"
				description="This link is missing its token. Request a new one from the sign-in page."
				tagline="Reset links are single-use and expire after one hour."
				action={{ href: '/auth/forgot', label: 'Request a new link' }}
			/>
		);
	return <ResetPasswordForm token={token} />;
}
