'use client';

import { BracesIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { insertReference, referenceQueryBefore, referenceSuggestions } from '@/lib/service-references';
import { cn } from '@/lib/utils';

type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
	value: string;
	onValueChange: (value: string) => void;
	serviceNames: string[];
};

// Text input that suggests `${{services.<name>.<property>}}` references once "${{" is typed at the caret.
export function ReferenceInput({ value, onValueChange, serviceNames, className, ...props }: Props) {
	const input = useRef<HTMLInputElement>(null);
	const [caret, setCaret] = useState<number | null>(null);
	const [highlight, setHighlight] = useState(0);
	const query = caret === null ? null : referenceQueryBefore(value.slice(0, caret));
	const suggestions = query ? referenceSuggestions(serviceNames, query.query).slice(0, 8) : [];

	const choose = (insert: string) => {
		if (!query || caret === null) return;
		const next = insertReference(value, query.start, caret, insert);
		onValueChange(next.text);
		setCaret(null);
		requestAnimationFrame(() => {
			input.current?.focus();
			input.current?.setSelectionRange(next.caret, next.caret);
		});
	};

	return (
		<div className="relative">
			<Input
				ref={input}
				value={value}
				className={cn('font-mono text-xs', className)}
				onChange={event => {
					onValueChange(event.target.value);
					setCaret(event.target.selectionStart);
					setHighlight(0);
				}}
				onKeyDown={event => {
					if (suggestions.length === 0) return;
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						setHighlight(current => (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
					}
					if (event.key === 'Enter' || event.key === 'Tab') {
						event.preventDefault();
						choose(suggestions[highlight]!.insert);
					}
					if (event.key === 'Escape') setCaret(null);
				}}
				onBlur={() => setTimeout(() => setCaret(null), 120)}
				{...props}
			/>
			{suggestions.length > 0 && (
				<div className="absolute top-9 right-0 left-0 z-30 rounded-md border bg-popover p-1 shadow-lg" role="listbox">
					<div className="px-2 py-1 text-[11px] text-muted-foreground">Reference</div>
					{suggestions.map((suggestion, index) => (
						<button
							key={suggestion.label}
							type="button"
							role="option"
							aria-selected={index === highlight}
							onMouseDown={event => event.preventDefault()}
							onClick={() => choose(suggestion.insert)}
							className={cn(
								'flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-accent',
								index === highlight && 'bg-accent'
							)}
						>
							<BracesIcon className="size-3 text-primary-text" />
							<span className="truncate">{suggestion.label}</span>
							<span className="ml-auto shrink-0 font-sans text-[11px] text-muted-foreground">{suggestion.detail}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
