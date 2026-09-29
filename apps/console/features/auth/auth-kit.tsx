'use client';

export { Field, FormError, FormField, SubmitButton } from '@/components/form-field';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

export function AuthCard({
	title,
	description,
	tagline,
	footer,
	className,
	children
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	tagline?: React.ReactNode;
	footer?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn('w-full max-w-sm', className)}>
			<div className="mb-6 flex justify-center text-lg">
				<Link href="/auth/login" aria-label="kubwave" className="flex rounded-md">
					<Logo />
				</Link>
			</div>
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
			{tagline && <p className="mt-4 text-center text-xs text-muted-foreground">{tagline}</p>}
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
