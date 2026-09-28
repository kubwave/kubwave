'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Heading = { id: string; text: string; level: number };

export function Toc() {
	const pathname = usePathname();
	const [headings, setHeadings] = useState<Heading[]>([]);
	const [active, setActive] = useState<string>();

	useEffect(() => {
		const elements = [...document.querySelectorAll<HTMLElement>('[data-docs-article] :is(h2, h3)[id]')];
		setHeadings(elements.map(el => ({ id: el.id, text: el.textContent ?? '', level: el.tagName === 'H2' ? 2 : 3 })));
		setActive(elements[0]?.id);
		const observer = new IntersectionObserver(
			entries => {
				const visible = entries.filter(entry => entry.isIntersecting);
				if (visible.length) setActive(visible[0]!.target.id);
			},
			{ rootMargin: '-64px 0px -70% 0px' }
		);
		elements.forEach(el => observer.observe(el));
		return () => observer.disconnect();
	}, [pathname]);

	if (!headings.length) return null;

	return (
		<nav aria-label="On this page" className="text-sm">
			<p className="mb-2 text-xs font-medium text-muted-foreground">On this page</p>
			<ul className="space-y-1 border-l">
				{headings.map(heading => (
					<li key={heading.id}>
						<a
							href={`#${heading.id}`}
							className={cn(
								'-ml-px block border-l py-0.5 text-muted-foreground transition-colors hover:text-foreground',
								heading.level === 3 ? 'pl-6' : 'pl-3',
								active === heading.id ? 'border-primary-text text-foreground' : 'border-transparent'
							)}
						>
							{heading.text}
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
