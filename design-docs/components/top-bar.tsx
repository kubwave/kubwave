'use client';

import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { SearchDialog, type SearchPage } from '@/components/search-dialog';
import { Sidebar } from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { repoUrl } from '@/lib/nav';

const Slash = () => (
	<svg viewBox="0 0 24 24" className="size-4 shrink-0 text-border" aria-hidden>
		<path d="M16 3 8 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
	</svg>
);

export const GithubMark = ({ className }: { className?: string }) => (
	<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
		<path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
	</svg>
);

export function TopBar({ pages }: { pages: SearchPage[] }) {
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
			<SearchDialog pages={pages} open={searchOpen} onOpenChange={setSearchOpen} />
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
