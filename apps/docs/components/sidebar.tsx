'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { docsNav } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function Sidebar({ className }: { className?: string }) {
	const pathname = usePathname().replace(/\/$/, '');
	return (
		<nav aria-label="Documentation" className={cn('space-y-6 text-sm', className)}>
			{docsNav.map(group => (
				<div key={group.title}>
					<p className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">{group.title}</p>
					<ul className="space-y-px">
						{group.items.map(item => (
							<li key={item.path}>
								<Link
									href={`${item.path}/`}
									aria-current={pathname === item.path ? 'page' : undefined}
									className={cn(
										'block rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
										pathname === item.path && 'bg-accent font-medium text-foreground'
									)}
								>
									{item.title}
								</Link>
							</li>
						))}
					</ul>
				</div>
			))}
		</nav>
	);
}
