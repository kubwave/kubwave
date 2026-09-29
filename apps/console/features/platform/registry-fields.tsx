'use client';

import { GlobeIcon, ServerIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import type { RegistryDraft, RegistryErrors, RegistryMode } from './registry-model';

const options = [
	{
		value: 'platform',
		icon: ServerIcon,
		title: 'Platform-managed',
		description: 'An in-cluster registry, provisioned and wired up for you.',
		recommended: true
	},
	{
		value: 'external',
		icon: GlobeIcon,
		title: 'External',
		description: 'Push to your own registry: GHCR, Harbor, ECR, Docker Hub.',
		recommended: false
	}
] as const;

function TextField({ id, label, error, ...props }: React.ComponentProps<typeof Input> & { id: string; label: string; error?: string }) {
	return (
		<div className="grid content-start gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Input id={id} aria-invalid={error ? true : undefined} {...props} />
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}

// Registry choice shared by first-run setup and platform settings.
export function RegistryFields({
	draft,
	errors,
	hasStoredPassword,
	onChange
}: {
	draft: RegistryDraft;
	errors: RegistryErrors;
	hasStoredPassword: boolean;
	onChange: (draft: RegistryDraft) => void;
}) {
	const set = <K extends keyof RegistryDraft>(key: K, value: RegistryDraft[K]) => onChange({ ...draft, [key]: value });
	return (
		<div className="grid gap-5">
			<RadioGroup
				value={draft.mode}
				onValueChange={value => set('mode', value as RegistryMode)}
				className="grid gap-3 sm:grid-cols-2"
				aria-label="Registry type"
			>
				{options.map(option => (
					<Label
						key={option.value}
						htmlFor={`registry-${option.value}`}
						className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-3.5 transition-colors hover:bg-accent/40 has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-primary/5"
					>
						<div className="flex w-full items-center justify-between">
							<span className="flex size-7 items-center justify-center rounded-md border bg-background">
								<option.icon className="size-3.5 text-muted-foreground" />
							</span>
							<RadioGroupItem value={option.value} id={`registry-${option.value}`} />
						</div>
						<span className="flex items-center gap-2">
							{option.title}
							{option.recommended && (
								<Badge variant="outline" className="border-primary/30 px-1.5 text-[10px] text-primary-text">
									Recommended
								</Badge>
							)}
						</span>
						<span className="text-xs leading-relaxed font-normal text-muted-foreground">{option.description}</span>
					</Label>
				))}
			</RadioGroup>

			{draft.mode === 'platform' ? (
				<div className="rounded-lg border border-dashed px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
					kubwave runs an in-cluster registry for build artifacts. You can switch to an external registry later in platform settings.
				</div>
			) : (
				<div className="grid gap-4">
					<TextField
						id="registry-endpoint"
						label="Endpoint"
						placeholder="ghcr.io/acme"
						className="font-mono"
						value={draft.endpoint}
						error={errors.endpoint}
						onChange={event => set('endpoint', event.target.value)}
					/>
					<div className="grid gap-4 sm:grid-cols-2">
						<TextField
							id="registry-username"
							label="Username"
							autoComplete="off"
							placeholder="kubwave-bot"
							value={draft.username}
							error={errors.username}
							onChange={event => set('username', event.target.value)}
						/>
						<TextField
							id="registry-password"
							label="Password or token"
							type="password"
							autoComplete="off"
							placeholder={hasStoredPassword ? 'Leave empty to keep the stored one' : undefined}
							value={draft.password}
							error={errors.password}
							onChange={event => set('password', event.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
						<div className="space-y-1">
							<Label htmlFor="registry-insecure">Insecure (HTTP)</Label>
							<p className="text-xs text-muted-foreground">Skip TLS. Only for registries on a trusted private network.</p>
						</div>
						<Switch id="registry-insecure" checked={draft.insecure} onCheckedChange={checked => set('insecure', checked)} />
					</div>
				</div>
			)}
		</div>
	);
}
