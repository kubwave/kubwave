'use client';

import { BracesIcon, EyeIcon, EyeOffIcon, FileTextIcon, LockIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { EnvVar, Service } from '@/lib/mock';
import { cn } from '@/lib/utils';

const refFields = ['host', 'port', 'internalUrl', 'domain', 'url'] as const;

function resolveRefs(value: string, services: Service[]) {
	return value.replace(/\$\{\{services\.([\w-]+)\.(\w+)\}\}/g, (m, name: string, field: string) => {
		const s = services.find(x => x.name === name);
		if (!s) return m;
		const internal = `http://${s.internalHost}${s.port ? `:${s.port}` : ''}`;
		const map: Record<string, string> = {
			host: s.internalHost,
			port: String(s.port ?? ''),
			internalUrl: internal,
			domain: s.domain ?? '',
			url: s.domain ? `https://${s.domain}` : internal,
			password: '••••••'
		};
		return map[field] ?? m;
	});
}

const toDotenv = (vars: EnvVar[]) => vars.map(v => `${v.key}=${v.value}`).join('\n');
const fromDotenv = (text: string, prev: EnvVar[]): EnvVar[] =>
	text
		.split('\n')
		.map(l => l.trim())
		.filter(l => l && !l.startsWith('#') && l.includes('='))
		.map(l => {
			const i = l.indexOf('=');
			const key = l.slice(0, i).trim();
			return { key, value: l.slice(i + 1).trim(), secret: prev.find(p => p.key === key)?.secret };
		});

export function VariablesTab({
	service,
	services,
	vars,
	onChange
}: {
	service: Service;
	services: Service[];
	vars: EnvVar[];
	onChange: (vars: EnvVar[]) => void;
}) {
	const [mode, setMode] = useState<'table' | 'raw'>('table');
	const [raw, setRaw] = useState(() => toDotenv(vars));
	const others = services.filter(s => s.id !== service.id);

	const update = (i: number, patch: Partial<EnvVar>) => onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="mr-auto">
					<h3 className="text-sm font-medium">Service variables</h3>
					<p className="text-xs text-muted-foreground">
						Reference other services with <code className="rounded bg-muted px-1 font-mono">{'${{services.name.host}}'}</code>. Changes are staged
						until you deploy.
					</p>
				</div>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={mode}
					onValueChange={v => {
						if (!v) return;
						if (v === 'raw') setRaw(toDotenv(vars));
						setMode(v as 'table' | 'raw');
					}}
				>
					<ToggleGroupItem value="table" aria-label="Table editor">
						<BracesIcon /> Table
					</ToggleGroupItem>
					<ToggleGroupItem value="raw" aria-label="Raw editor">
						<FileTextIcon /> Raw
					</ToggleGroupItem>
				</ToggleGroup>
			</div>

			{mode === 'raw' ? (
				<div className="space-y-2">
					<Textarea
						value={raw}
						onChange={e => {
							setRaw(e.target.value);
							onChange(fromDotenv(e.target.value, vars));
						}}
						spellCheck={false}
						className="min-h-72 font-mono text-xs leading-5"
						aria-label="Variables as .env"
					/>
					<p className="text-xs text-muted-foreground">One KEY=value per line. Paste an existing .env file to import it.</p>
				</div>
			) : (
				<div className="rounded-lg border">
					{vars.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">No variables yet.</div>}
					{vars.map((v, i) => (
						<VarRow
							key={i}
							v={v}
							services={services}
							others={others}
							onChange={p => update(i, p)}
							onRemove={() => onChange(vars.filter((_, j) => j !== i))}
						/>
					))}
					<div className="flex items-center gap-2 border-t p-2">
						<Button variant="ghost" size="sm" onClick={() => onChange([...vars, { key: '', value: '' }])}>
							<PlusIcon /> New variable
						</Button>
						<Button variant="ghost" size="sm" onClick={() => onChange([...vars, { key: '', value: '', secret: true }])}>
							<LockIcon /> New secret
						</Button>
						{others.length > 0 && (
							<Button
								variant="ghost"
								size="sm"
								className="ml-auto text-muted-foreground"
								onClick={() =>
									onChange([
										...vars,
										{ key: `${others[0]!.name.toUpperCase().replace(/-/g, '_')}_URL`, value: `\${{services.${others[0]!.name}.internalUrl}}` }
									])
								}
							>
								<BracesIcon /> Add reference
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function VarRow({
	v,
	services,
	others,
	onChange,
	onRemove
}: {
	v: EnvVar;
	services: Service[];
	others: Service[];
	onChange: (p: Partial<EnvVar>) => void;
	onRemove: () => void;
}) {
	const [reveal, setReveal] = useState(false);
	const [focused, setFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const open = v.value.match(/\$\{\{([\w.-]*)$/);
	const fragment = open?.[1] ?? '';
	const suggestions = open
		? others
				.flatMap(s => refFields.map(f => `services.${s.name}.${f}`))
				.filter(s => s.startsWith(fragment) || s.includes(fragment))
				.slice(0, 8)
		: [];
	const resolved = v.value.includes('${{') ? resolveRefs(v.value, services) : null;

	return (
		<div className="group grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2 border-b px-2 py-2 last:border-b-0">
			<Input
				value={v.key}
				onChange={e => onChange({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
				placeholder="KEY"
				className="h-8 font-mono text-xs"
				aria-label="Variable name"
			/>
			<div className="relative">
				<Input
					ref={inputRef}
					value={v.value}
					type={v.secret && !reveal ? 'password' : 'text'}
					onChange={e => onChange({ value: e.target.value })}
					onFocus={() => setFocused(true)}
					onBlur={() => setTimeout(() => setFocused(false), 120)}
					placeholder={v.secret ? 'secret value' : 'value or ${{'}
					className={cn('h-8 font-mono text-xs', v.secret && 'pr-8')}
					aria-label={`Value of ${v.key || 'variable'}`}
				/>
				{v.secret && (
					<button
						type="button"
						onClick={() => setReveal(r => !r)}
						className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						aria-label={reveal ? 'Hide value' : 'Show value'}
					>
						{reveal ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
					</button>
				)}
				{resolved && !(v.secret && !reveal) && <div className="mt-1 truncate px-1 font-mono text-[11px] text-muted-foreground">→ {resolved}</div>}
				{focused && suggestions.length > 0 && (
					<div className="absolute top-9 right-0 left-0 z-30 rounded-md border bg-popover p-1 shadow-lg" role="listbox">
						<div className="px-2 py-1 text-[11px] text-muted-foreground">Reference</div>
						{suggestions.map(s => (
							<button
								key={s}
								type="button"
								role="option"
								aria-selected={false}
								onMouseDown={e => e.preventDefault()}
								onClick={() => {
									onChange({ value: v.value.replace(/\$\{\{[\w.-]*$/, `\${{${s}}}`) });
									inputRef.current?.focus();
								}}
								className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-accent"
							>
								<BracesIcon className="size-3 text-primary-text" />
								{s}
							</button>
						))}
					</div>
				)}
			</div>
			<div className="flex items-center">
				{v.secret && (
					<Tooltip>
						<TooltipTrigger asChild>
							<LockIcon className="mx-1 size-3.5 text-muted-foreground" aria-label="Secret" />
						</TooltipTrigger>
						<TooltipContent>Stored as a Kubernetes Secret</TooltipContent>
					</Tooltip>
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onRemove}
					aria-label={`Remove ${v.key || 'variable'}`}
					className="opacity-60 group-hover:opacity-100"
				>
					<Trash2Icon />
				</Button>
			</div>
		</div>
	);
}
