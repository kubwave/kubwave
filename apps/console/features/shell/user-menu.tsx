'use client';

import { BotIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/features/auth/session-provider';
import { UserAvatar } from './avatars';

export function UserMenu() {
	const { user, signOut } = useSession();
	const { theme, setTheme } = useTheme();
	if (!user) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
				<UserAvatar name={user.name} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel className="font-normal">
					<div className="truncate text-sm font-medium">{user.name}</div>
					<div className="truncate text-xs text-muted-foreground">{user.email}</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/account">
						<UserIcon className="size-4" />
						Account
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/account/mcp">
						<BotIcon className="size-4" />
						AI access (MCP)
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/team/settings">
						<UsersIcon className="size-4" />
						Team settings
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<SunIcon className="size-4" />
						Theme
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
							<DropdownMenuRadioItem value="light">
								<SunIcon className="size-4" /> Light
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="dark">
								<MoonIcon className="size-4" /> Dark
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="system">
								<MonitorIcon className="size-4" /> System
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => void signOut()}>
					<LogOutIcon className="size-4" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
