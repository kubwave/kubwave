'use client';

import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';

export function useDraft<T extends Record<string, unknown>>(initial: T) {
	const [saved, setSaved] = useState(initial);
	const [draft, setDraft] = useState(initial);
	return {
		saved,
		draft,
		changes: Object.keys(saved).filter(k => draft[k] !== saved[k]).length,
		set: <K extends keyof T>(key: K, value: T[K]) => setDraft(d => ({ ...d, [key]: value })),
		discard: () => setDraft(saved),
		save: () => setSaved(draft)
	};
}

export function SaveBar({
	changes,
	pending = false,
	onDiscard,
	onSave
}: {
	changes: number;
	pending?: boolean;
	onDiscard: () => void;
	onSave: () => void;
}) {
	useEffect(() => {
		if (!changes) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 's') {
				e.preventDefault();
				if (!pending) onSave();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [changes, pending, onSave]);

	if (!changes) return null;
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
			<div
				role="status"
				className="pointer-events-auto flex animate-in items-center gap-1 rounded-lg border bg-popover py-1 pr-1 pl-3 text-sm shadow-lg shadow-black/10 duration-150 fade-in-0 slide-in-from-bottom-2 dark:shadow-black/40"
			>
				<span className="mr-2 flex items-center gap-2">
					<span className="size-1.5 rounded-full bg-warning" aria-hidden />
					<span className="tabular-nums">
						{changes} unsaved change{changes === 1 ? '' : 's'}
					</span>
				</span>
				<Button variant="ghost" size="sm" disabled={pending} onClick={onDiscard}>
					Discard
				</Button>
				<Button size="sm" disabled={pending} onClick={onSave}>
					{pending && <LoaderCircleIcon className="animate-spin" />}
					Save changes
					<Kbd className="hidden bg-primary-foreground/10 text-primary-foreground/80 sm:inline-flex">⌘S</Kbd>
				</Button>
			</div>
		</div>
	);
}
