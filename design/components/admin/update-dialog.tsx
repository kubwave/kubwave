'use client';

import { ArrowRightIcon, CheckIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { updateLog } from '@/lib/mock-admin';

const pad = (n: number) => String(n).padStart(2, '0');

export function UpdateDialog({ from, to, onComplete, children }: { from: string; to: string; onComplete: () => void; children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<'confirm' | 'running' | 'done'>('confirm');
	const [lines, setLines] = useState(0);
	const logRef = useRef<HTMLOListElement>(null);
	const total = updateLog.length;

	useEffect(() => {
		if (step !== 'running') return;
		const id = setInterval(() => setLines(n => Math.min(n + 1, total)), 700);
		return () => clearInterval(id);
	}, [step, total]);

	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
		if (step === 'running' && lines === total) setStep('done');
	}, [lines, step, total]);

	const running = step === 'running';
	const close = () => {
		setOpen(false);
		if (step === 'done') onComplete();
		setStep('confirm');
		setLines(0);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				if (o) setOpen(true);
				else if (!running) close();
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent showCloseButton={!running} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{step === 'done' ? 'Update complete' : 'Update kubwave'}
						<span className="ml-1 inline-flex items-center gap-1.5 font-mono text-sm font-normal text-muted-foreground">
							{from} <ArrowRightIcon className="size-3.5" /> <span className="text-foreground">{to}</span>
						</span>
					</DialogTitle>
					<DialogDescription>
						{step === 'confirm' && 'Runs an atomic Helm upgrade. If any rollout fails, kubwave rolls back to the previous release automatically.'}
						{running && 'Updating the control plane. This usually takes a couple of minutes.'}
						{step === 'done' && `kubwave ${to} is live. The API restarted and all components are healthy.`}
					</DialogDescription>
				</DialogHeader>

				{step === 'confirm' ? (
					<ul className="space-y-2 text-sm">
						{[
							'The API restarts; the console may be unavailable for about 30 seconds.',
							'Running builds and deployments continue and are picked up again by the worker.',
							'Database migrations run before the new API accepts traffic.'
						].map(t => (
							<li key={t} className="flex gap-2 text-muted-foreground">
								<CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								{t}
							</li>
						))}
					</ul>
				) : (
					<div className="space-y-3">
						<div className="flex items-center gap-3">
							<Progress value={(lines / total) * 100} className="h-1.5" aria-label="Update progress" />
							<span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round((lines / total) * 100)}%</span>
						</div>
						<ol ref={logRef} className="h-60 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-6" aria-live="polite">
							{updateLog.slice(0, Math.min(lines + 1, total)).map((l, i) => (
								<li key={i} className="flex items-center gap-2">
									<span className="text-muted-foreground">{`14:31:${pad(4 + i * 3)}`}</span>
									{i < lines ? (
										<CheckIcon className="size-3.5 shrink-0 text-success" />
									) : (
										<LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
									)}
									<span className={i < lines ? '' : 'text-muted-foreground'}>{l.replaceAll('{v}', to)}</span>
								</li>
							))}
						</ol>
						{step === 'done' && (
							<p className="flex items-center gap-2 text-sm text-success">
								<CircleCheckIcon className="size-4" />
								Updated in 2m 36s
							</p>
						)}
					</div>
				)}

				<DialogFooter>
					{step === 'confirm' && (
						<>
							<Button variant="outline" onClick={close}>
								Cancel
							</Button>
							<Button onClick={() => setStep('running')}>Start update</Button>
						</>
					)}
					{running && (
						<Button disabled>
							<LoaderCircleIcon className="animate-spin" />
							Updating…
						</Button>
					)}
					{step === 'done' && <Button onClick={close}>Done</Button>}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
