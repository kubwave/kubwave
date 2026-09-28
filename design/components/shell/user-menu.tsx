'use client';

import { BotIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { currentUser } from '@/lib/mock';

export function UserAvatar({ initials = currentUser.initials, className = 'size-7' }: { initials?: string; className?: string }) {
	return (
		<Avatar className={className}>
			<AvatarFallback className="bg-secondary text-[11px] font-medium text-secondary-foreground ring-1 ring-border ring-inset">
				{initials}
			</AvatarFallback>
		</Avatar>
	);
}

export function UserMenu() {
	const { theme, setTheme } = useTheme();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
				<UserAvatar />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel className="font-normal">
					<div className="text-sm font-medium">{currentUser.name}</div>
					<div className="text-xs text-muted-foreground">{currentUser.email}</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/account">
						<UserIcon className="size-4" />
						Account
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/account#ai-access">
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
				<DropdownMenuItem asChild>
					<Link href="/login">
						<LogOutIcon className="size-4" />
						Sign out
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
