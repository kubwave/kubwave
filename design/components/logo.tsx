import { cn } from '@/lib/utils';

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
	return (
		<span className={cn('inline-flex items-center gap-2', className)}>
			<img src="/logo.png" alt="kubwave" className="size-6" />
			{showText && <span className="text-[0.95rem] font-semibold tracking-tight">kubwave</span>}
		</span>
	);
}
