import { ArrowRightIcon, CircleAlertIcon, InfoIcon, LightbulbIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const callouts = {
	note: { label: 'Note', icon: InfoIcon, className: 'border-info [&_svg]:text-info' },
	tip: { label: 'Tip', icon: LightbulbIcon, className: 'border-success [&_svg]:text-success' },
	caution: { label: 'Caution', icon: TriangleAlertIcon, className: 'border-warning [&_svg]:text-warning' },
	danger: { label: 'Danger', icon: CircleAlertIcon, className: 'border-destructive [&_svg]:text-destructive' }
};

export function Callout({ type = 'note', title, children }: { type?: keyof typeof callouts; title?: string; children: React.ReactNode }) {
	const tone = callouts[type];
	return (
		<aside className={cn('my-6 border-l-2 py-0.5 pl-4 text-sm', tone.className)}>
			<p className="flex items-center gap-1.5 font-medium">
				<tone.icon className="size-3.5 shrink-0" />
				{title ?? tone.label}
			</p>
			<div className="mt-1 text-muted-foreground [&_p]:my-1.5 [&_p]:leading-6 [&>*:last-child]:mb-0">{children}</div>
		</aside>
	);
}

export function Steps({ children }: { children: React.ReactNode }) {
	return <div className="steps my-6">{children}</div>;
}

export function Cards({ children }: { children: React.ReactNode }) {
	return <div className="my-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-lg border px-4 py-3.5">
			<p className="text-sm font-medium">{title}</p>
			<div className="mt-1 text-sm leading-6 text-muted-foreground [&_p]:my-1 [&_p]:leading-6">{children}</div>
		</div>
	);
}

export function LinkCard({ title, href, description }: { title: string; href: string; description?: string }) {
	const body = (
		<>
			<span className="flex items-center justify-between gap-3 text-sm font-medium">
				{title}
				<ArrowRightIcon className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
			</span>
			{description && <span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span>}
		</>
	);
	const className = 'group my-3 block rounded-lg border px-4 py-3.5 transition-colors hover:bg-accent';
	return href.startsWith('/') ? (
		<Link href={href} className={className}>
			{body}
		</Link>
	) : (
		<a href={href} target="_blank" rel="noreferrer" className={className}>
			{body}
		</a>
	);
}
