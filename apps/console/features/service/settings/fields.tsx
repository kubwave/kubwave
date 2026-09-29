'use client';

import { Trash2Icon } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Service } from '@/lib/api/types';
import type { ServiceSettingsValues, SettingsErrors } from '@/lib/service-settings';
import { cn } from '@/lib/utils';

export type SectionProps = {
	service: Service;
	values: ServiceSettingsValues;
	errors: SettingsErrors;
	set: (patch: Partial<ServiceSettingsValues>) => void;
};

export function Group({
	title,
	description,
	action,
	children
}: {
	title?: string;
	description?: React.ReactNode;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-3 border-t pt-6 first:border-t-0 first:pt-0">
			{(title || description || action) && (
				<div className="flex items-start justify-between gap-3">
					<div>
						{title && <h4 className="text-sm font-medium">{title}</h4>}
						{description && <p className="text-xs text-muted-foreground">{description}</p>}
					</div>
					{action}
				</div>
			)}
			{children}
		</section>
	);
}

export function FieldError({ message }: { message?: string }) {
	return message ? <p className="text-[11px] text-destructive">{message}</p> : null;
}

type TextSettingProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
	label: string;
	value: string;
	onValueChange: (value: string) => void;
	error?: string;
	hint?: React.ReactNode;
	mono?: boolean;
};

export function TextSetting({ label, value, onValueChange, error, hint, mono, className, ...props }: TextSettingProps) {
	const id = useId();
	return (
		<div className={cn('space-y-1.5', className)}>
			<Label htmlFor={id} className="text-xs">
				{label}
			</Label>
			<Input
				id={id}
				value={value}
				onChange={event => onValueChange(event.target.value)}
				aria-invalid={error ? true : undefined}
				className={cn('h-8', mono && 'font-mono text-xs')}
				{...props}
			/>
			{error ? <FieldError message={error} /> : hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
		</div>
	);
}

export function ToggleSetting({
	label,
	hint,
	checked,
	disabled,
	onCheckedChange,
	error
}: {
	label: string;
	hint?: React.ReactNode;
	checked: boolean;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
	error?: string;
}) {
	const id = useId();
	return (
		<div className="space-y-1">
			<div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
				<div>
					<Label htmlFor={id} className="text-sm">
						{label}
					</Label>
					{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
				</div>
				<Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
			</div>
			<FieldError message={error} />
		</div>
	);
}

export function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={label}
			onClick={onClick}
			className="shrink-0 text-muted-foreground hover:text-destructive"
		>
			<Trash2Icon />
		</Button>
	);
}

// Replaces one row of a list field by index.
export function replaceAt<T>(rows: T[], index: number, patch: Partial<T>): T[] {
	return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}
