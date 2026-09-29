import { cn } from '@/lib/utils';

export function StatTile({
	label,
	value,
	hint,
	icon,
	className
}: {
	label: string;
	value: React.ReactNode;
	hint?: React.ReactNode;
	icon?: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('rounded-lg border bg-card p-4', className)}>
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				{label}
				{icon}
			</div>
			<div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
			{hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
		</div>
	);
}
