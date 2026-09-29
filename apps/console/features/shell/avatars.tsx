import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function TeamAvatar({ name, className = 'size-5 text-[10px]' }: { name: string; className?: string }) {
	return (
		<span className={cn('inline-flex shrink-0 items-center justify-center rounded bg-foreground font-semibold text-background', className)}>
			{name[0]?.toUpperCase()}
		</span>
	);
}

export function UserAvatar({ name, className = 'size-7' }: { name: string; className?: string }) {
	return (
		<Avatar className={className}>
			<AvatarFallback className="bg-secondary text-[11px] font-medium text-secondary-foreground ring-1 ring-border ring-inset">
				{initials(name)}
			</AvatarFallback>
		</Avatar>
	);
}
