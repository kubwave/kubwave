'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string | (() => string); label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			onClick={() => {
				void navigator.clipboard?.writeText(typeof value === 'function' ? value() : value);
				setCopied(true);
				setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
		</Button>
	);
}
