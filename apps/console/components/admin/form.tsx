'use client';

import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export function Row({
	label,
	description,
	htmlFor,
	children
}: {
	label: string;
	description?: React.ReactNode;
	htmlFor?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-0.5">
				<Label htmlFor={htmlFor}>{label}</Label>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

export function Suffixed({ suffix, className, ...props }: React.ComponentProps<typeof Input> & { suffix: string }) {
	return (
		<div className="relative">
			<Input inputMode="numeric" className={cn('pr-12 tabular-nums', className)} {...props} />
			<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
		</div>
	);
}

export function Field({
	label,
	htmlFor,
	hint,
	error,
	children,
	className
}: {
	label: string;
	htmlFor: string;
	hint?: React.ReactNode;
	error?: string | null;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('space-y-2', className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{error ? <p className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

export function Choice({
	value,
	title,
	description,
	icon: Icon
}: {
	value: string;
	title: string;
	description?: React.ReactNode;
	icon?: React.ComponentType<{ className?: string }>;
}) {
	return (
		<label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-primary/5">
			<RadioGroupItem value={value} className="mt-0.5" />
			<span className="min-w-0 flex-1 space-y-0.5">
				<span className="flex items-center gap-1.5 text-sm font-medium">
					{Icon && <Icon className="size-3.5 text-muted-foreground" />}
					{title}
				</span>
				{description && <span className="block text-xs text-muted-foreground">{description}</span>}
			</span>
		</label>
	);
}

export function SecretInput({
	id,
	value,
	onChange,
	placeholder
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
}) {
	const [show, setShow] = useState(false);
	return (
		<div className="relative">
			<Input
				id={id}
				type={show ? 'text' : 'password'}
				autoComplete="off"
				value={value}
				onChange={e => onChange(e.target.value)}
				placeholder={placeholder}
				className="pr-9 font-mono"
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				className="absolute top-1/2 right-1.5 -translate-y-1/2"
				aria-label={show ? 'Hide value' : 'Show value'}
				onClick={() => setShow(!show)}
			>
				{show ? <EyeOffIcon /> : <EyeIcon />}
			</Button>
		</div>
	);
}
