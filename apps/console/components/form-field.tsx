'use client';

import type { AnyFieldApi } from '@tanstack/react-form';
import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fieldError } from '@/lib/forms';
import { cn } from '@/lib/utils';

export type FieldProps = React.ComponentProps<typeof Input> & {
	id: string;
	label: React.ReactNode;
	aside?: React.ReactNode;
	hint?: React.ReactNode;
	error?: string;
};

export function Field({ id, label, aside, hint, error, ...props }: FieldProps) {
	return (
		<div className="grid content-start gap-2">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={id}>{label}</Label>
				{aside}
			</div>
			<Input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...props} />
			{error ? (
				<p id={`${id}-error`} className="text-xs text-destructive">
					{error}
				</p>
			) : (
				hint
			)}
		</div>
	);
}

// A Field bound to a TanStack form field of type string.
export function FormField({ field, ...props }: Omit<FieldProps, 'id' | 'value' | 'onChange' | 'onBlur' | 'error'> & { field: AnyFieldApi }) {
	return (
		<Field
			id={field.name}
			value={field.state.value as string}
			onChange={event => field.handleChange(event.target.value)}
			onBlur={field.handleBlur}
			error={fieldError(field.state.meta)}
			{...props}
		/>
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

export function FormError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
			<CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
			{message}
		</p>
	);
}
