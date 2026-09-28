import { cn } from '@/lib/utils';

const styles: Record<string, string> = {
	'1': 'font-semibold text-white',
	'2': 'text-zinc-500',
	'31': 'text-red-400',
	'32': 'text-emerald-400',
	'33': 'text-amber-300',
	'36': 'text-cyan-300'
};

export function AnsiLine({ text }: { text: string }) {
	const parts = text.split(/\x1b\[(\d+)m/);
	const out: React.ReactNode[] = [];
	let active = '';
	parts.forEach((part, i) => {
		if (i % 2 === 1) {
			active = part === '0' ? '' : (styles[part] ?? '');
			return;
		}
		if (part)
			out.push(
				<span key={i} className={cn(active)}>
					{part}
				</span>
			);
	});
	return <>{out}</>;
}

export function Terminal({ lines, className }: { lines: string[]; className?: string }) {
	return (
		<div className={cn('overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-[12px] leading-5 text-zinc-300 ring-1 ring-white/5', className)}>
			{lines.map((l, i) => (
				<div key={i} className="flex gap-3 whitespace-pre-wrap">
					<span className="w-6 shrink-0 text-right text-zinc-600 select-none">{i + 1}</span>
					<span className="min-w-0">
						<AnsiLine text={l} />
					</span>
				</div>
			))}
		</div>
	);
}
