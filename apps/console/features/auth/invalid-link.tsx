import { Link2OffIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AuthCard, AuthNotice } from './auth-kit';

export function InvalidLink({
	title,
	description,
	tagline,
	action
}: {
	title: string;
	description: string;
	tagline: string;
	action: { href: string; label: string };
}) {
	return (
		<AuthCard tagline={tagline}>
			<AuthNotice icon={<Link2OffIcon />} tone="destructive" title={title} description={description}>
				<Button asChild variant="outline">
					<Link href={action.href}>{action.label}</Link>
				</Button>
			</AuthNotice>
		</AuthCard>
	);
}
