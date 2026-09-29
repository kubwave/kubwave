'use client';

import { apiData } from '@kubwave/api-client';
import { useQuery } from '@tanstack/react-query';
import { CopyIcon, DownloadIcon, LoaderCircleIcon, PauseIcon, PlayIcon, SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseAnsi, stripAnsi } from '@/lib/ansi';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Service, ServiceLogEntry } from '@/lib/api/types';
import { downloadText } from '@/lib/download';
import { appendLogEntries, logKey } from './buffers';

const MAX_LINES = 1000;
const TAIL_LINES = 200;

// Polls every 3s while following, into a bounded de-duplicated buffer; pausing keeps what is shown.
function useServiceLogs(serviceId: string, pod: string, follow: boolean) {
	const [entries, setEntries] = useState<ServiceLogEntry[]>([]);
	const logs = useQuery({
		queryKey: queryKeys.serviceLogs(serviceId, pod, TAIL_LINES),
		queryFn: () =>
			apiData(
				getBrowserApi()
					.services(serviceId)
					.logs.get(pod === 'all' ? { tailLines: TAIL_LINES } : { pod, tailLines: TAIL_LINES })
			),
		enabled: follow,
		refetchInterval: follow ? 3000 : false
	});
	const data = logs.data;
	useEffect(() => {
		if (data?.available) setEntries(current => appendLogEntries(current, data.entries, MAX_LINES));
	}, [data]);
	return { entries, pods: data?.pods ?? [], available: data?.available ?? true, loading: logs.isPending && follow };
}

const clock = (timestamp: string | null) => {
	if (!timestamp) return '';
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export function LogsTab({ service }: { service: Service }) {
	const [pod, setPod] = useState('all');
	return <PodLogs key={pod} service={service} pod={pod} onPodChange={setPod} />;
}

function PodLogs({ service, pod, onPodChange }: { service: Service; pod: string; onPodChange: (pod: string) => void }) {
	const [follow, setFollow] = useState(true);
	const [filter, setFilter] = useState('');
	const scroller = useRef<HTMLDivElement>(null);
	const { entries, pods, available, loading } = useServiceLogs(service.id, pod, follow);
	const needle = filter.trim().toLowerCase();
	const shown = needle ? entries.filter(entry => stripAnsi(entry.message).toLowerCase().includes(needle)) : entries;
	const multiPod = pods.length > 1;

	// Keyed on the entries, not their count: a full buffer keeps its length while lines roll through.
	useEffect(() => {
		if (follow) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
	}, [entries, needle, follow]);
	// Stable row keys (content-based, numbered for identical lines) so rolling lines don't remount every row.
	const occurrences = new Map<string, number>();
	const rowKey = (entry: (typeof shown)[number]) => {
		const key = logKey(entry);
		const n = occurrences.get(key) ?? 0;
		occurrences.set(key, n + 1);
		return `${key}#${n}`;
	};

	const text = shown.map(entry => [clock(entry.timestamp), multiPod ? entry.pod : '', stripAnsi(entry.message)].filter(Boolean).join(' ')).join('\n');

	return (
		<div className="flex h-full min-h-[28rem] flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
				<Select value={pod} onValueChange={onPodChange}>
					<SelectTrigger size="sm" className="w-44 text-xs" aria-label="Pod">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All pods ({pods.length})</SelectItem>
						{pods.map(name => (
							<SelectItem key={name} value={name} className="font-mono text-xs">
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="relative min-w-40 flex-1">
					<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={filter}
						onChange={event => setFilter(event.target.value)}
						placeholder="Filter logs"
						className="h-8 pl-8 text-xs"
						aria-label="Filter logs"
					/>
				</div>
				<Button variant={follow ? 'secondary' : 'outline'} size="sm" onClick={() => setFollow(value => !value)}>
					{follow ? <PauseIcon /> : <PlayIcon />}
					{follow ? 'Pause' : 'Follow'}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Copy logs"
					onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success('Logs copied'))}
				>
					<CopyIcon />
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Download logs" onClick={() => downloadText(`${service.name}.log`, text)}>
					<DownloadIcon />
				</Button>
			</div>
			{!available ? (
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					No running pods. Logs appear once the service is up.
				</div>
			) : loading && entries.length === 0 ? (
				<div className="flex flex-1 items-center justify-center text-muted-foreground">
					<LoaderCircleIcon className="size-4 animate-spin" />
				</div>
			) : (
				<div
					ref={scroller}
					className="flex-1 overflow-y-auto bg-zinc-950 py-2 font-mono text-[12px] leading-5 text-zinc-300"
					role="log"
					aria-live="off"
				>
					{shown.length === 0 && <div className="px-5 text-zinc-500">{needle ? 'No lines match the filter.' : 'No log lines yet.'}</div>}
					{shown.map(entry => (
						<div key={rowKey(entry)} className="flex gap-3 px-5 hover:bg-white/5">
							<span className="shrink-0 text-zinc-500">{clock(entry.timestamp)}</span>
							{multiPod && <span className="w-28 shrink-0 truncate text-zinc-500">{entry.pod}</span>}
							<span className="min-w-0 break-all">
								{parseAnsi(entry.message).map((segment, segmentIndex) => (
									<span key={segmentIndex} className={segment.classes}>
										{segment.text}
									</span>
								))}
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
