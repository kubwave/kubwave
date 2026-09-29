'use client';

import { BracesIcon, EyeIcon, EyeOffIcon, FileTextIcon, FileUpIcon, LockIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Service } from '@/lib/api/types';
import { formatDotenv, parseDotenv } from '@/lib/parse-dotenv';
import { previewReferences } from '@/lib/service-references';
import { importDotenv, rowId, type ServiceSettingsValues, type SettingsErrors } from '@/lib/service-settings';
import { ReferenceInput } from './reference-input';

type Update = (change: (values: ServiceSettingsValues) => ServiceSettingsValues) => void;

// Variables and secrets share one fixed column grid, so name and value inputs line up across both kinds of row.
const VARIABLE_ROW = 'group grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_3.5rem] items-start gap-2 border-b px-2 py-2';

export function VariablesTab({
	values,
	errors,
	update,
	services,
	serviceId
}: {
	values: ServiceSettingsValues;
	errors: SettingsErrors;
	update: Update;
	services: Service[];
	serviceId: string;
}) {
	const [mode, setMode] = useState<'table' | 'raw'>('table');
	const [importOpen, setImportOpen] = useState(false);
	const others = services.filter(service => service.id !== serviceId);
	const otherNames = others.map(service => service.name);

	const setEnv = (index: number, patch: Partial<{ key: string; value: string }>) =>
		update(current => ({ ...current, env: current.env.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) }));
	const setSecret = (index: number, patch: Partial<{ key: string; value: string }>) =>
		update(current => ({ ...current, secrets: current.secrets.map((secret, i) => (i === index ? { ...secret, ...patch } : secret)) }));

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="mr-auto">
					<h3 className="text-sm font-medium">Service variables</h3>
					<p className="text-xs text-muted-foreground">
						Reference other services with <code className="rounded bg-muted px-1 font-mono">{'${{services.name.host}}'}</code>. Changes are staged
						until you save or deploy.
					</p>
				</div>
				<ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={value => value && setMode(value as 'table' | 'raw')}>
					<ToggleGroupItem value="table" aria-label="Table editor">
						<BracesIcon /> Table
					</ToggleGroupItem>
					<ToggleGroupItem value="raw" aria-label="Raw editor">
						<FileTextIcon /> Raw
					</ToggleGroupItem>
				</ToggleGroup>
			</div>

			{mode === 'raw' ? (
				<RawEditor values={values} update={update} />
			) : (
				<div className="rounded-lg border">
					{values.env.length === 0 && values.secrets.length === 0 && (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">No variables yet.</div>
					)}
					{values.env.map((entry, index) => (
						<div key={entry._id} className={VARIABLE_ROW}>
							<Input
								value={entry.key}
								onChange={event => setEnv(index, { key: event.target.value })}
								placeholder="KEY"
								className="h-8 font-mono text-xs"
								aria-label="Variable name"
								aria-invalid={errors[`env.${index}.key`] ? true : undefined}
							/>
							<div>
								<ReferenceInput
									value={entry.value}
									onValueChange={value => setEnv(index, { value })}
									serviceNames={otherNames}
									placeholder="value or ${{"
									className="h-8"
									aria-label={`Value of ${entry.key || 'variable'}`}
								/>
								{entry.value.includes('${{') && (
									<div className="mt-1 truncate px-1 font-mono text-[11px] text-muted-foreground">→ {previewReferences(entry.value, services)}</div>
								)}
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => update(current => ({ ...current, env: current.env.filter((_, i) => i !== index) }))}
								aria-label={`Remove ${entry.key || 'variable'}`}
								className="justify-self-end opacity-60 group-hover:opacity-100"
							>
								<Trash2Icon />
							</Button>
						</div>
					))}
					{values.secrets.map((secret, index) => (
						<SecretRow
							key={secret._id}
							secret={secret}
							invalid={Boolean(errors[`secrets.${index}.key`])}
							onChange={patch => setSecret(index, patch)}
							onRemove={() => update(current => ({ ...current, secrets: current.secrets.filter((_, i) => i !== index) }))}
						/>
					))}
					<div className="flex flex-wrap items-center gap-2 p-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => update(current => ({ ...current, env: [...current.env, { _id: rowId(), key: '', value: '' }] }))}
						>
							<PlusIcon /> New variable
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								update(current => ({ ...current, secrets: [...current.secrets, { _id: rowId(), key: '', value: '', hasValue: false }] }))
							}
						>
							<LockIcon /> New secret
						</Button>
						{others[0] && (
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground"
								onClick={() =>
									update(current => ({
										...current,
										env: [
											...current.env,
											{
												_id: rowId(),
												key: `${others[0]!.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`,
												value: `\${{services.${others[0]!.name}.internalUrl}}`
											}
										]
									}))
								}
							>
								<BracesIcon /> Add reference
							</Button>
						)}
						<Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => setImportOpen(true)}>
							<FileUpIcon /> Import .env
						</Button>
					</div>
				</div>
			)}
			<ImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				onImport={(entries, asSecrets) => update(current => importDotenv(current, entries, asSecrets))}
			/>
		</div>
	);
}

function SecretRow({
	secret,
	invalid,
	onChange,
	onRemove
}: {
	secret: ServiceSettingsValues['secrets'][number];
	invalid: boolean;
	onChange: (patch: Partial<{ key: string; value: string }>) => void;
	onRemove: () => void;
}) {
	const [reveal, setReveal] = useState(false);
	return (
		<div className={VARIABLE_ROW}>
			{/* A stored secret keeps its name: renaming would drop the stored value, which the UI can't read back. */}
			<Input
				value={secret.key}
				onChange={event => onChange({ key: event.target.value })}
				readOnly={secret.hasValue}
				aria-invalid={invalid ? true : undefined}
				title={secret.hasValue ? 'Stored secrets keep their name. Remove it and add a new one to rename.' : undefined}
				placeholder="KEY"
				className="h-8 font-mono text-xs read-only:text-muted-foreground"
				aria-label="Secret name"
			/>
			<div className="relative">
				<Input
					value={secret.value}
					type={reveal ? 'text' : 'password'}
					autoComplete="off"
					onChange={event => onChange({ value: event.target.value })}
					placeholder={secret.hasValue ? 'Stored — type to replace' : 'secret value'}
					className="h-8 pr-8 font-mono text-xs"
					aria-label={`Value of ${secret.key || 'secret'}`}
				/>
				{secret.value && (
					<button
						type="button"
						onClick={() => setReveal(value => !value)}
						className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						aria-label={reveal ? 'Hide value' : 'Show value'}
					>
						{reveal ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
					</button>
				)}
			</div>
			<div className="flex items-center justify-end">
				<Tooltip>
					<TooltipTrigger asChild>
						<LockIcon className="mx-1 size-3.5 text-muted-foreground" aria-label="Secret" />
					</TooltipTrigger>
					<TooltipContent>Encrypted at rest and write-only. Stored values are never shown.</TooltipContent>
				</Tooltip>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onRemove}
					aria-label={`Remove ${secret.key || 'secret'}`}
					className="opacity-60 group-hover:opacity-100"
				>
					<Trash2Icon />
				</Button>
			</div>
		</div>
	);
}

// Plain variables as .env text. Secrets are write-only and stay in the table.
function RawEditor({ values, update }: { values: ServiceSettingsValues; update: Update }) {
	const [text, setText] = useState(() => formatDotenv(values.env));
	// Follow outside changes (Discard, table edits): compare in parsed form, which ignores
	// in-progress lines the parser skips, so typing never resets the text.
	const parsed = JSON.stringify(parseDotenv(text));
	const current = JSON.stringify(parseDotenv(formatDotenv(values.env)));
	if (parsed !== current) setText(formatDotenv(values.env));
	return (
		<div className="space-y-2">
			<Textarea
				value={text}
				onChange={event => {
					setText(event.target.value);
					const entries = parseDotenv(event.target.value);
					update(current => ({
						...current,
						env: entries.map(({ key, value }) => ({ _id: current.env.find(entry => entry.key === key)?._id ?? rowId(), key, value }))
					}));
				}}
				spellCheck={false}
				className="min-h-72 font-mono text-xs leading-5"
				aria-label="Variables as .env"
			/>
			<p className="text-xs text-muted-foreground">One KEY=value per line. Secrets are write-only and are edited in the table view.</p>
		</div>
	);
}

function ImportDialog({
	open,
	onOpenChange,
	onImport
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onImport: (entries: Array<{ key: string; value: string }>, asSecrets: boolean) => void;
}) {
	const [text, setText] = useState('');
	const [asSecrets, setAsSecrets] = useState(false);
	const entries = parseDotenv(text);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Import .env</DialogTitle>
					<DialogDescription>Paste a .env file. Keys that already exist are replaced.</DialogDescription>
				</DialogHeader>
				<Textarea
					value={text}
					onChange={event => setText(event.target.value)}
					spellCheck={false}
					className="min-h-48 font-mono text-xs"
					placeholder="DATABASE_URL=postgres://…"
				/>
				<Label className="flex items-center gap-2 text-sm font-normal">
					<Checkbox checked={asSecrets} onCheckedChange={checked => setAsSecrets(checked === true)} />
					Import as secrets
				</Label>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={entries.length === 0}
						onClick={() => {
							onImport(entries, asSecrets);
							setText('');
							onOpenChange(false);
						}}
					>
						Import {entries.length > 0 ? entries.length : ''} {entries.length === 1 ? 'variable' : 'variables'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
