import { cn } from '@/lib/utils';

export function PageHeader({
	title,
	description,
	actions,
	eyebrow,
	className
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	eyebrow?: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
			<div className="min-w-0 space-y-1">
				{eyebrow && <div className="text-xs text-muted-foreground">{eyebrow}</div>}
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
