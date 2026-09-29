'use client';

import type { AnyFieldApi } from '@tanstack/react-form';
import { ChevronDownIcon } from 'lucide-react';
import Link from 'next/link';
import { Field as LabeledField } from '@/components/admin/form';
import { SubmitButton } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Service } from '@/lib/api/types';
import { fieldError } from '@/lib/forms';
import { cn } from '@/lib/utils';

// What every source form gets from the dialog.
export type SourceFormProps = {
	environmentId: string;
	taken: string[];
	onCreated: (services: Service[]) => void;
	onClose: () => void;
};

export function StepBody({ className, children }: { className?: string; children: React.ReactNode }) {
	return <div className={cn('max-h-[60vh] space-y-4 overflow-y-auto px-5 py-5', className)}>{children}</div>;
}

export function StepFooter({ onCancel, start, children }: { onCancel: () => void; start?: React.ReactNode; children: React.ReactNode }) {
	return (
		<DialogFooter className="border-t bg-muted/40 px-5 py-3">
			{start && <div className="sm:mr-auto">{start}</div>}
			<Button type="button" variant="outline" onClick={onCancel}>
				Cancel
			</Button>
			{children}
		</DialogFooter>
	);
}

// A TanStack form rendered as dialog body + footer.
export function FormStep({
	onSubmit,
	onCancel,
	submitting,
	submitLabel,
	children
}: {
	onSubmit: () => void;
	onCancel: () => void;
	submitting: boolean;
	submitLabel: string;
	children: React.ReactNode;
}) {
	return (
		<form
			noValidate
			className="flex min-h-0 flex-col"
			onSubmit={event => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<StepBody>{children}</StepBody>
			<StepFooter onCancel={onCancel}>
				<SubmitButton pending={submitting} className="w-auto">
					{submitLabel}
				</SubmitButton>
			</StepFooter>
		</form>
	);
}

export function SwitchRow({
	id,
	label,
	description,
	checked,
	onCheckedChange,
	disabled
}: {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
			<div className="space-y-0.5">
				<Label htmlFor={id}>{label}</Label>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
			<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
		</div>
	);
}

export function SwitchField({
	field,
	...props
}: Omit<React.ComponentProps<typeof SwitchRow>, 'id' | 'checked' | 'onCheckedChange'> & { field: AnyFieldApi }) {
	return <SwitchRow id={field.name} checked={field.state.value as boolean} onCheckedChange={checked => field.handleChange(checked)} {...props} />;
}

export function SelectField({
	id,
	label,
	value,
	onValueChange,
	placeholder,
	disabled,
	error,
	hint,
	className,
	children
}: {
	id: string;
	label: string;
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	error?: string;
	hint?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<LabeledField label={label} htmlFor={id} error={error} hint={hint} className={className}>
			<Select value={value} onValueChange={onValueChange} disabled={disabled}>
				<SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>{children}</SelectContent>
			</Select>
		</LabeledField>
	);
}

export function FormSelect({
	field,
	...props
}: Omit<React.ComponentProps<typeof SelectField>, 'id' | 'value' | 'onValueChange' | 'error'> & { field: AnyFieldApi }) {
	return (
		<SelectField
			id={field.name}
			value={field.state.value as string}
			onValueChange={value => field.handleChange(value)}
			error={fieldError(field.state.meta)}
			{...props}
		/>
	);
}

export function FormTextarea({
	field,
	label,
	hint,
	className,
	...props
}: Omit<React.ComponentProps<typeof Textarea>, 'id' | 'value' | 'onChange' | 'onBlur'> & {
	field: AnyFieldApi;
	label: string;
	hint?: React.ReactNode;
}) {
	const error = fieldError(field.state.meta);
	return (
		<LabeledField label={label} htmlFor={field.name} error={error} hint={hint}>
			<Textarea
				id={field.name}
				value={field.state.value as string}
				onChange={event => field.handleChange(event.target.value)}
				onBlur={field.handleBlur}
				aria-invalid={error ? true : undefined}
				spellCheck={false}
				className={cn('font-mono text-xs', className)}
				{...props}
			/>
		</LabeledField>
	);
}

export function Advanced({ children }: { children: React.ReactNode }) {
	return (
		<Collapsible>
			<CollapsibleTrigger asChild>
				<Button type="button" variant="link" size="sm" className="group h-auto px-0 text-muted-foreground">
					Advanced
					<ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="grid gap-4 pt-3 sm:grid-cols-2">{children}</CollapsibleContent>
		</Collapsible>
	);
}

export function SettingsHint({ href, link, className, children }: { href: string; link: string; className?: string; children: React.ReactNode }) {
	return (
		<span className={cn('text-xs text-muted-foreground', className)}>
			{children}{' '}
			<Link href={href} className="font-medium text-foreground underline underline-offset-4">
				{link}
			</Link>
			.
		</span>
	);
}
