'use client';

import { CopyIcon, DownloadIcon, PauseIcon, PlayIcon, SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { logLine, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';

export function LogsTab({ service }: { service: Service }) {
	const [count, setCount] = useState(40);
	const [follow, setFollow] = useState(true);
	const [filter, setFilter] = useState('');
	const [pod, setPod] = useState('all');
	const scroller = useRef<HTMLDivElement>(null);
	const running = service.replicas[0] > 0;

	useEffect(() => {
		if (!follow || !running) return;
		const t = window.setInterval(() => setCount(c => c + 1), 900);
		return () => window.clearInterval(t);
	}, [follow, running]);

	const lines = Array.from({ length: count }, (_, i) => logLine(service, i));
	const pods = [...new Set(lines.map(l => l.pod))];
	const shown = lines.filter(l => (pod === 'all' || l.pod === pod) && (!filter || l.message.toLowerCase().includes(filter.toLowerCase())));
	const multiPod = pods.length > 1;

	useEffect(() => {
		if (follow) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
	}, [shown.length, follow]);

	const text = shown.map(l => `${l.time} ${multiPod ? `${l.pod} ` : ''}${l.message}`).join('\n');

	return (
		<div className="flex h-full min-h-[28rem] flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
				<Select value={pod} onValueChange={setPod}>
					<SelectTrigger size="sm" className="w-44 text-xs" aria-label="Pod">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All pods ({pods.length})</SelectItem>
						{pods.map(p => (
							<SelectItem key={p} value={p} className="font-mono text-xs">
								{p}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="relative min-w-40 flex-1">
					<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={filter}
						onChange={e => setFilter(e.target.value)}
						placeholder="Filter logs"
						className="h-8 pl-8 text-xs"
						aria-label="Filter logs"
					/>
				</div>
				<Button variant={follow ? 'secondary' : 'outline'} size="sm" onClick={() => setFollow(f => !f)} disabled={!running}>
					{follow ? <PauseIcon /> : <PlayIcon />}
					{follow ? 'Pause' : 'Follow'}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Copy logs"
					onClick={() => {
						void navigator.clipboard?.writeText(text);
						toast.success('Logs copied');
					}}
				>
					<CopyIcon />
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Download logs" asChild>
					<a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download={`${service.name}.log`}>
						<DownloadIcon />
					</a>
				</Button>
			</div>
			{!running ? (
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					No running pods. Logs appear once the service is up.
				</div>
			) : (
				<div
					ref={scroller}
					className="flex-1 overflow-y-auto bg-zinc-950 py-2 font-mono text-[12px] leading-5 text-zinc-300"
					role="log"
					aria-live="off"
				>
					{shown.map(l => (
						<div key={l.id} className="flex gap-3 px-5 hover:bg-white/5">
							<span className="shrink-0 text-zinc-500">{l.time}</span>
							{multiPod && <span className="w-28 shrink-0 truncate text-zinc-500">{l.pod}</span>}
							<span
								className={cn('min-w-0 break-all', l.message.startsWith('ERROR') && 'text-red-400', l.message.startsWith('WARN') && 'text-amber-300')}
							>
								{l.message}
							</span>
						</div>
					))}
					{follow && (
						<div className="flex items-center gap-2 px-5 pt-1 text-zinc-500">
							<span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Streaming
						</div>
					)}
				</div>
			)}
		</div>
	);
}
