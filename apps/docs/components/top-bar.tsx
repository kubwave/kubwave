'use client';

import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { GithubMark } from '@/components/github-mark';
import { SearchDialog } from '@/components/search-dialog';
import { Sidebar } from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionSwitcher } from '@/components/version-switcher';
import { repoUrl } from '@/lib/nav';

const Slash = () => (
	<svg viewBox="0 0 24 24" className="size-4 shrink-0 text-border" aria-hidden>
		<path d="M16 3 8 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
	</svg>
);

export function TopBar() {
	const pathname = usePathname();
	const { resolvedTheme, setTheme } = useTheme();
	const [searchOpen, setSearchOpen] = useState(false);
	const [navOpen, setNavOpen] = useState(false);

	useEffect(() => setNavOpen(false), [pathname]);

	return (
		<header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
			<div className="mx-auto flex h-12 max-w-[88rem] items-center gap-1 px-3">
				<Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
					<MenuIcon />
				</Button>
				<Link href="/" className="flex rounded-md p-1 hover:bg-accent" aria-label="Docs home">
					<Logo showText={false} />
				</Link>
				<Slash />
				<Link href="/" className="rounded-md px-1.5 py-1 text-sm font-medium hover:bg-accent">
					Docs
				</Link>
				<VersionSwitcher />
				<div className="ml-auto flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setSearchOpen(true)}
						className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent md:flex"
					>
						<SearchIcon className="size-3.5" />
						Search docs…
						<Kbd className="ml-auto">⌘K</Kbd>
					</button>
					<Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
						<SearchIcon />
					</Button>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-sm" aria-label="GitHub" asChild>
								<a href={repoUrl} target="_blank" rel="noreferrer">
									<GithubMark className="size-4" />
								</a>
							</Button>
						</TooltipTrigger>
						<TooltipContent>GitHub</TooltipContent>
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
				</div>
			</div>
			<SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
			<Sheet open={navOpen} onOpenChange={setNavOpen}>
				<SheetContent side="left" className="w-72 gap-0 overflow-y-auto">
					<SheetHeader className="border-b">
						<SheetTitle>
							<Logo />
						</SheetTitle>
						<SheetDescription className="sr-only">Documentation navigation</SheetDescription>
					</SheetHeader>
					<Sidebar className="p-3" />
				</SheetContent>
			</Sheet>
		</header>
	);
}
