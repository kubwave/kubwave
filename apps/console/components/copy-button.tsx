'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	// The clipboard API needs a secure context; over plain http it is missing, so say so instead of faking success.
	const copy = async () => {
		try {
			if (!navigator.clipboard) throw new Error('clipboard unavailable');
			await navigator.clipboard.writeText(value);
			setCopied(true);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 1200);
		} catch {
			toast.error('Could not copy. Select the text and copy it manually.');
		}
	};

	return (
		<Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={() => void copy()}>
			{copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
		</Button>
	);
}
