import type { AnsiSegment } from '@/lib/ansi';
import { cn } from '@/lib/utils';

export type TerminalLine = { segments: AnsiSegment[]; divider?: string };

// Dark terminal with line numbers, ANSI colors and optional phase dividers (build containers).
export function Terminal({ lines, className }: { lines: TerminalLine[]; className?: string }) {
	return (
		<div className={cn('overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-[12px] leading-5 text-zinc-300 ring-1 ring-white/5', className)}>
			{lines.map((line, index) => (
				<div key={index}>
					{line.divider && <div className="my-1 border-t border-white/10 pt-1 text-[11px] tracking-wide text-zinc-500 uppercase">{line.divider}</div>}
					<div className="flex gap-3 whitespace-pre-wrap">
						<span className="w-8 shrink-0 text-right text-zinc-600 select-none">{index + 1}</span>
						<span className="min-w-0 break-all">
							{line.segments.map((segment, segmentIndex) => (
								<span key={segmentIndex} className={segment.classes}>
									{segment.text}
								</span>
							))}
						</span>
					</div>
				</div>
			))}
		</div>
	);
}
