'use client';

import { LoaderCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function AuthCard({
	title,
	description,
	tagline,
	footer,
	below,
	className,
	children
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	tagline?: React.ReactNode;
	footer?: React.ReactNode;
	below?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn('w-full max-w-sm', className)}>
			<Link href="/login" aria-label="kubwave" className="mb-6 flex w-fit rounded-md">
				<Logo />
			</Link>
			<div className="rounded-lg border bg-card">
				<div className="p-6">
					{title && (
						<div className="mb-6 space-y-1">
							<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
							{description && <p className="text-sm text-muted-foreground">{description}</p>}
						</div>
					)}
					{children}
				</div>
				{footer && <div className="border-t px-6 py-3 text-xs text-muted-foreground">{footer}</div>}
			</div>
			{tagline && <p className="mt-4 text-xs text-muted-foreground">{tagline}</p>}
			{below}
		</div>
	);
}

export function Field({
	id,
	label,
	aside,
	hint,
	...props
}: React.ComponentProps<typeof Input> & { id: string; label: React.ReactNode; aside?: React.ReactNode; hint?: React.ReactNode }) {
	return (
		<div className="grid content-start gap-2">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={id}>{label}</Label>
				{aside}
			</div>
			<Input id={id} name={id} {...props} />
			{hint}
		</div>
	);
}

export function PasswordStrength({ value }: { value: string }) {
	const score = !value
		? 0
		: value.length < 8
			? 1
			: 1 + [value.length >= 12, /[a-z]/.test(value) && /[A-Z]/.test(value), /[\d\W]/.test(value)].filter(Boolean).length;
	const label = value.length > 0 && value.length < 8 ? 'Too short' : ['', 'Weak', 'Fair', 'Good', 'Strong'][score];
	const color = ['', 'bg-destructive', 'bg-warning', 'bg-info', 'bg-success'][score];
	return (
		<div className="flex items-center gap-3">
			<div className="grid flex-1 grid-cols-4 gap-1">
				{[0, 1, 2, 3].map(i => (
					<span key={i} className={cn('h-1 rounded-full bg-muted transition-colors', i < score && color)} />
				))}
			</div>
			<span className="w-14 text-right text-[11px] text-muted-foreground" aria-live="polite">
				{label}
			</span>
		</div>
	);
}

export function SubmitButton({ pending, disabled, children, className, ...props }: React.ComponentProps<typeof Button> & { pending?: boolean }) {
	return (
		<Button type="submit" className={cn('w-full', className)} disabled={pending || disabled} {...props}>
			{pending && <LoaderCircleIcon className="animate-spin" />}
			{children}
		</Button>
	);
}

export function useFakeSubmit(ms = 700) {
	const [pending, setPending] = useState(false);
	const submit = (then: () => void) => (e: React.FormEvent) => {
		e.preventDefault();
		setPending(true);
		setTimeout(() => {
			setPending(false);
			then();
		}, ms);
	};
	return { pending, submit };
}

const tones = {
	success: 'text-success',
	primary: 'text-muted-foreground',
	destructive: 'text-destructive'
};

export function AuthNotice({
	icon,
	tone,
	title,
	description,
	children
}: {
	icon: React.ReactNode;
	tone: keyof typeof tones;
	title: string;
	description: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div>
			<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
				<span className={cn('[&_svg]:size-4.5', tones[tone])}>{icon}</span>
				{title}
			</h1>
			<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			{children && <div className="mt-6 grid w-full gap-2">{children}</div>}
		</div>
	);
}

export function PreviewToggle({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="mt-3 block rounded text-xs text-muted-foreground/60 underline-offset-4 transition-colors hover:text-muted-foreground hover:underline"
		>
			{children}
		</button>
	);
}
