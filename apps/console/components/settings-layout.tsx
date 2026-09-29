'use client';

import { cn } from '@/lib/utils';

export type Section = { id: string; label: string; icon?: React.ComponentType<{ className?: string }>; badge?: React.ReactNode };

export function SettingsLayout({
	sections,
	active,
	onChange,
	children
}: {
	sections: Section[];
	active: string;
	onChange: (id: string) => void;
	children: React.ReactNode;
}) {
	return (
		<div className="grid gap-8 md:grid-cols-[200px_1fr]">
			<nav className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col md:self-start" aria-label="Sections">
				{sections.map(s => (
					<button
						key={s.id}
						type="button"
						onClick={() => onChange(s.id)}
						aria-current={active === s.id ? 'page' : undefined}
						className={cn(
							'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
							active === s.id && 'bg-accent font-medium text-foreground'
						)}
					>
						{s.icon && <s.icon className="size-4" />}
						<span className="flex-1">{s.label}</span>
						{s.badge}
					</button>
				))}
			</nav>
			<div className="min-w-0 space-y-6">{children}</div>
		</div>
	);
}

export function SettingsCard({
	title,
	description,
	children,
	footer,
	tone,
	className
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	children?: React.ReactNode;
	footer?: React.ReactNode;
	tone?: 'danger';
	className?: string;
}) {
	return (
		<section className={cn('rounded-lg border bg-card', tone === 'danger' && 'border-destructive/40', className)}>
			<header className="space-y-1 px-5 pt-5">
				<h2 className={cn('text-base font-semibold', tone === 'danger' && 'text-destructive')}>{title}</h2>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</header>
			{children && <div className="px-5 py-5">{children}</div>}
			{footer && <footer className="flex items-center justify-end gap-2 border-t bg-muted/40 px-5 py-3">{footer}</footer>}
		</section>
	);
}
