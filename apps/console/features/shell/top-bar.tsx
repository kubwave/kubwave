'use client';

import { BookOpenIcon, MoonIcon, SearchIcon, ShieldIcon, SunIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/session-provider';
import { AdminSwitcher, EnvironmentSwitcher, ProjectSwitcher } from './project-switchers';
import { useShellState } from './shell-state';
import { TeamSwitcher } from './team-switcher';
import { UserMenu } from './user-menu';

const DOCS_URL = 'https://docs.kubwave.com';

const Slash = () => (
	<svg viewBox="0 0 24 24" className="size-4 shrink-0 text-border" aria-hidden>
		<path d="M16 3 8 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
	</svg>
);

export function TopBar() {
	const pathname = usePathname();
	const { projectId } = useParams<{ projectId?: string }>();
	const { user } = useSession();
	const { setPaletteOpen } = useShellState();
	const { resolvedTheme, setTheme } = useTheme();
	const isAdminRoute = pathname.startsWith('/admin');
	const onCanvas = projectId && !pathname.endsWith('/settings');

	return (
		<header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
			<div className="flex h-12 items-center gap-1 px-3">
				<Link href="/" className="mr-1 flex rounded-md p-1 hover:bg-accent" aria-label="Home">
					<Logo showText={false} />
				</Link>
				<Slash />
				<TeamSwitcher />
				{projectId && (
					<>
						<Slash />
						<ProjectSwitcher projectId={projectId} />
						{onCanvas && (
							<>
								<Slash />
								<EnvironmentSwitcher projectId={projectId} />
							</>
						)}
					</>
				)}
				{isAdminRoute && (
					<>
						<Slash />
						<span className="flex items-center gap-1.5 px-1.5 text-sm font-medium">
							<ShieldIcon className="size-3.5 text-muted-foreground" />
							Admin
						</span>
						<Slash />
						<AdminSwitcher pathname={pathname} />
					</>
				)}
				<div className="ml-auto flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setPaletteOpen(true)}
						className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent md:flex"
					>
						<SearchIcon className="size-3.5" />
						Search…
						<Kbd className="ml-auto">⌘K</Kbd>
					</button>
					<Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
						<SearchIcon />
					</Button>
					{user?.isAdmin && !isAdminRoute && (
						<Button variant="ghost" size="sm" asChild className="text-muted-foreground">
							<Link href="/admin/monitoring">
								<ShieldIcon />
								<span className="hidden sm:inline">Admin</span>
							</Link>
						</Button>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-sm" aria-label="Docs" asChild>
								<a href={DOCS_URL} target="_blank" rel="noreferrer">
									<BookOpenIcon />
								</a>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Docs</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
								<SunIcon className="hidden dark:block" />
								<MoonIcon className="dark:hidden" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Toggle theme</TooltipContent>
					</Tooltip>
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
