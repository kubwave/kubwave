import { EyeIcon, KeyRoundIcon, PencilIcon, RocketIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import type { mcpScope } from '@/lib/mcp';
import { cn } from '@/lib/utils';

type Scope = ReturnType<typeof mcpScope>;

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
	read: EyeIcon,
	write: PencilIcon,
	deploy: RocketIcon,
	delete: Trash2Icon,
	'team:manage': UsersIcon
};

// MCP scopes with destructive ones called out, shared by OAuth consent and token creation.
export function ScopeList({ scopes, className }: { scopes: Scope[]; className?: string }) {
	return (
		<ul className={cn('divide-y rounded-lg border', className)}>
			{scopes.map(scope => {
				const Icon = icons[scope.value] ?? KeyRoundIcon;
				return (
					<li key={scope.value} className="flex items-start gap-3 px-3 py-2.5">
						<span
							className={cn(
								'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border',
								scope.destructive ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
							)}
						>
							<Icon className="size-3.5" />
						</span>
						<div className="min-w-0">
							<div className={cn('text-sm font-medium', scope.destructive && 'text-destructive')}>{scope.label}</div>
							<div className="text-xs text-muted-foreground">{scope.description}</div>
						</div>
					</li>
				);
			})}
		</ul>
	);
}
