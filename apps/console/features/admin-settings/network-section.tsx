'use client';

import { LoaderCircleIcon, ShieldAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { Field, Row } from '@/components/admin/form';
import { SettingsCard } from '@/components/settings-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadError } from '@/components/settings/parts';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { tcpPoolGroup } from './model';
import { UpdateProgressDialog } from './update-progress-dialog';
import { useTcpPoolSetting } from './use-platform-settings';
import { useSettingsGroup } from './use-settings-group';

export function useTcpPoolGroup() {
	const [runId, setRunId] = useState<string | null>(null);
	const pool = useTcpPoolSetting();
	const group = useSettingsGroup(tcpPoolGroup, pool.query, async payload => setRunId((await pool.save(payload)).updateRun.id));
	return { group, saving: pool.saving, runId };
}

export function NetworkSection({ group, saving, runId }: ReturnType<typeof useTcpPoolGroup>) {
	const [progressOpen, setProgressOpen] = useState(false);
	// A failed reconciliation can be re-applied without changing anything.
	const [retry, setRetry] = useState(false);
	const { draft, errors, set } = group;

	if (group.failed) return <LoadError what="the TCP port pool settings" onRetry={group.retry} className="rounded-lg border" />;
	if (!group.loaded) return <Skeleton className="h-72 rounded-lg" />;

	const apply = async () => {
		await group.save();
		setRetry(false);
		setProgressOpen(true);
	};
	const start = Number(draft.start);
	const end = start + Number(draft.size) - 1;

	return (
		<>
			<SettingsCard
				title="Public TCP port pool"
				description="Raw TCP ports for explicitly exposed services, such as database migration endpoints."
				footer={
					<>
						<span className="mr-auto text-xs text-muted-foreground">Applying reconfigures Traefik, the load balancer, API and worker.</span>
						<Button size="sm" disabled={(!group.dirty && !retry) || !group.valid || saving} onClick={() => void apply().catch(() => undefined)}>
							{saving && <LoaderCircleIcon className="animate-spin" />}
							{retry ? 'Retry network settings' : 'Apply network settings'}
						</Button>
					</>
				}
			>
				<div className="space-y-5">
					<Row
						label="Enable public TCP ports"
						htmlFor="tcp"
						description="A disabled pool rejects new exposures and removes all Traefik TCP listeners once the update completes."
					>
						<Switch id="tcp" checked={draft.enabled} disabled={saving} onCheckedChange={enabled => set({ enabled })} />
					</Row>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="First public port" htmlFor="tcp-start" error={errors.start} hint="1024 to 65535.">
							<Input
								id="tcp-start"
								inputMode="numeric"
								disabled={saving}
								value={draft.start}
								onChange={event => set({ start: event.target.value })}
								aria-invalid={Boolean(errors.start)}
								className="font-mono"
							/>
						</Field>
						<Field label="Pool size" htmlFor="tcp-size" error={errors.size} hint={group.valid ? `Ports ${start}–${end}.` : '1 to 100 ports.'}>
							<Input
								id="tcp-size"
								inputMode="numeric"
								disabled={saving}
								value={draft.size}
								onChange={event => set({ size: event.target.value })}
								aria-invalid={Boolean(errors.size)}
								className="font-mono"
							/>
						</Field>
					</div>
					<p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
						<ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
						Changes are blocked while an existing service exposure would fall outside the new pool. Public TCP ports are reachable from the internet.
					</p>
				</div>
			</SettingsCard>

			<UpdateProgressDialog runId={runId} open={progressOpen} onOpenChange={setProgressOpen} onFailed={() => setRetry(true)} />
		</>
	);
}
