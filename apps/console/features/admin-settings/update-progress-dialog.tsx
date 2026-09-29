'use client';

import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isTerminalUpdateStatus, updateRunStatusLabel, updateRunTitle } from './update-runs';
import { useInvalidateSystem, useUpdateRunProgress } from './use-system';

export function UpdateProgressDialog({
	runId,
	open,
	onOpenChange,
	autoReload = false,
	onFailed
}: {
	runId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Only a freshly triggered platform update reloads on success, not a historical run's logs.
	autoReload?: boolean;
	onFailed?: () => void;
}) {
	const { run, logs } = useUpdateRunProgress(runId, open);
	const invalidateSystem = useInvalidateSystem();
	const notifiedRunId = useRef<string | null>(null);
	const logRef = useRef<HTMLPreElement>(null);
	const finished = isTerminalUpdateStatus(run?.status);
	const succeeded = run?.status === 'succeeded';
	const failed = finished && !succeeded;

	useEffect(() => {
		if (!open) notifiedRunId.current = null;
		if (!open || !finished || !runId || notifiedRunId.current === runId) return;
		notifiedRunId.current = runId;
		invalidateSystem();
		if (failed) onFailed?.();
		if (succeeded && autoReload) setTimeout(() => window.location.reload(), 3000);
	}, [open, finished, failed, succeeded, runId, autoReload, onFailed, invalidateSystem]);

	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [logs]);

	const blockWhileRunning = (event: Event) => {
		if (!finished) event.preventDefault();
	};
	const tone = succeeded ? 'text-success' : failed ? 'text-destructive' : 'text-info';
	const StatusIcon = succeeded ? CircleCheckIcon : failed ? CircleXIcon : LoaderCircleIcon;

	return (
		<Dialog open={open} onOpenChange={next => (next || finished) && onOpenChange(next)}>
			<DialogContent
				showCloseButton={finished}
				className="sm:max-w-xl"
				onEscapeKeyDown={blockWhileRunning}
				onPointerDownOutside={blockWhileRunning}
				onInteractOutside={blockWhileRunning}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<StatusIcon className={cn('size-4', tone, !finished && 'animate-spin')} />
						{run?.kind === 'tcp_port_pool' ? 'Network reconciliation' : 'Platform update'}
						{run && <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{updateRunTitle(run)}</span>}
					</DialogTitle>
					<DialogDescription className={cn(finished && tone)}>{updateRunStatusLabel(run)}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
						<div className={cn('h-full w-full rounded-full', succeeded ? 'bg-success' : failed ? 'bg-destructive' : 'animate-pulse bg-info/60')} />
					</div>
					{!finished && <p className="text-xs text-muted-foreground">Please wait — the console may be briefly unavailable while this runs.</p>}
					{run?.lastError && (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs break-all text-destructive">
							{run.lastError}
						</p>
					)}
					{logs && (
						<pre
							ref={logRef}
							aria-live="polite"
							className="h-60 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap"
						>
							{logs}
						</pre>
					)}
					{succeeded && autoReload && (
						<p className="flex items-center gap-2 text-sm text-success">
							<CircleCheckIcon className="size-4" />
							Update complete. The page reloads automatically…
						</p>
					)}
				</div>

				{finished && (
					<DialogFooter>
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Close
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
