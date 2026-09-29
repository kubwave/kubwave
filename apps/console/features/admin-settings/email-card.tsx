'use client';

import { LoaderCircleIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { Field, Row, SecretInput } from '@/components/admin/form';
import { SettingsCard } from '@/components/settings-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/features/auth/session-provider';
import { isEmail } from './model';
import { useSendTestEmail } from './use-platform-settings';
import type { IntegrationGroups } from './use-settings-tabs';

export function EmailCard({ group }: { group: IntegrationGroups['smtp'] }) {
	const { draft, errors, set, source } = group;
	const { user } = useSession();
	const [testTo, setTestTo] = useState(user?.email ?? '');
	const sendTest = useSendTestEmail();

	return (
		<SettingsCard
			title={
				<span className="flex items-center gap-2">
					Email (SMTP)
					{source?.source === 'env-default' && <Badge variant="secondary">Using defaults</Badge>}
				</span>
			}
			description="Outgoing mail for invitations, password resets and notifications."
			footer={
				<form
					className="flex w-full flex-wrap items-center gap-2"
					onSubmit={event => {
						event.preventDefault();
						if (isEmail(testTo)) sendTest.mutate(testTo.trim());
					}}
				>
					<span className="mr-auto text-xs text-muted-foreground">Uses the saved settings. Save your changes first.</span>
					<Input
						type="email"
						aria-label="Test recipient"
						placeholder="you@example.com"
						value={testTo}
						onChange={event => setTestTo(event.target.value)}
						className="h-8 w-56"
					/>
					<Button type="submit" variant="outline" size="sm" disabled={sendTest.isPending || !isEmail(testTo)}>
						{sendTest.isPending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
						Send test email
					</Button>
				</form>
			}
		>
			<div className="space-y-5">
				<Row label="Enable email sending" htmlFor="smtp-enabled" description="When off, invitations and notifications are not sent.">
					<Switch id="smtp-enabled" checked={draft.enabled} onCheckedChange={enabled => set({ enabled })} />
				</Row>
				<div className="grid gap-4 sm:grid-cols-6">
					<Field label="Host" htmlFor="smtp-host" error={errors.host} className="sm:col-span-4">
						<Input
							id="smtp-host"
							value={draft.host}
							onChange={event => set({ host: event.target.value })}
							aria-invalid={Boolean(errors.host)}
							placeholder="smtp.example.com"
							className="font-mono"
						/>
					</Field>
					<Field label="Port" htmlFor="smtp-port" error={errors.port} className="sm:col-span-2">
						<Input
							id="smtp-port"
							inputMode="numeric"
							value={draft.port}
							onChange={event => set({ port: event.target.value })}
							aria-invalid={Boolean(errors.port)}
							className="font-mono"
						/>
					</Field>
					<div className="sm:col-span-6">
						<Row label="Implicit TLS (port 465)" htmlFor="smtp-secure" description="Leave off for STARTTLS (587) or unencrypted dev servers (1025).">
							<Switch id="smtp-secure" checked={draft.secure} onCheckedChange={secure => set({ secure })} />
						</Row>
					</div>
					<Field label="Username" htmlFor="smtp-user" hint="Leave empty for no authentication." className="sm:col-span-3">
						<Input id="smtp-user" value={draft.user} onChange={event => set({ user: event.target.value })} autoComplete="off" />
					</Field>
					<Field label="Password" htmlFor="smtp-password" className="sm:col-span-3">
						<SecretInput
							id="smtp-password"
							value={draft.password}
							onChange={password => set({ password })}
							placeholder={source?.hasPassword ? '•••••••• stored, leave empty to keep' : undefined}
						/>
					</Field>
					<Field label="From name" htmlFor="smtp-from-name" error={errors.fromName} className="sm:col-span-3">
						<Input
							id="smtp-from-name"
							value={draft.fromName}
							onChange={event => set({ fromName: event.target.value })}
							aria-invalid={Boolean(errors.fromName)}
							placeholder="kubwave"
						/>
					</Field>
					<Field label="From address" htmlFor="smtp-from-address" error={errors.fromAddress} className="sm:col-span-3">
						<Input
							id="smtp-from-address"
							type="email"
							value={draft.fromAddress}
							onChange={event => set({ fromAddress: event.target.value })}
							aria-invalid={Boolean(errors.fromAddress)}
							placeholder="noreply@example.com"
						/>
					</Field>
				</div>
			</div>
		</SettingsCard>
	);
}
