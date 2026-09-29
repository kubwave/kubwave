'use client';

import { BotIcon, PaletteIcon, UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { type Section, SettingsLayout } from '@/components/settings-layout';
import { Badge } from '@/components/ui/badge';
import { useSession } from '@/features/auth/session-provider';
import { UserAvatar } from '@/features/shell/avatars';

export type AccountSection = 'profile' | 'appearance' | 'mcp';

const sections: Section[] = [
	{ id: 'profile', label: 'Profile', icon: UserIcon },
	{ id: 'appearance', label: 'Appearance', icon: PaletteIcon },
	{ id: 'mcp', label: 'AI access (MCP)', icon: BotIcon }
];

// /account switches profile and appearance in place (onSelect); AI access is its own route, /account/mcp.
export function AccountLayout({
	active,
	onSelect,
	children
}: {
	active: AccountSection;
	onSelect?: (section: AccountSection) => void;
	children: React.ReactNode;
}) {
	const { user } = useSession();
	const router = useRouter();

	const select = (id: string) => {
		if (id === 'mcp') return router.push('/account/mcp');
		if (onSelect) return onSelect(id as AccountSection);
		router.push(`/account#${id}`);
	};

	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
			{user && (
				<PageHeader
					eyebrow="Account"
					title={
						<span className="flex items-center gap-3">
							<UserAvatar name={user.name} className="size-7" />
							{user.name}
						</span>
					}
					description={user.email}
					actions={
						user.isAdmin && (
							<Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary-text">
								Instance admin
							</Badge>
						)
					}
				/>
			)}
			<SettingsLayout sections={sections} active={active} onChange={select}>
				{children}
			</SettingsLayout>
		</div>
	);
}
