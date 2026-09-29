'use client';

import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Group, TextSetting, ToggleSetting, type SectionProps } from './fields';

const BUILDERS = [
	{ value: 'nixpacks', label: 'Nixpacks', description: 'Detects the stack automatically' },
	{ value: 'dockerfile', label: 'Dockerfile', description: 'Use a Dockerfile from the repository' }
];

export function BuildSection({ service, values, set }: SectionProps) {
	const poll = service.autoDeploy;
	const root = values.rootDirectory.trim();
	return (
		<>
			<Group title="Builder">
				<RadioGroup value={values.builder} onValueChange={builder => set({ builder })} className="grid gap-2 @md:grid-cols-2">
					{BUILDERS.map(builder => (
						<Label
							key={builder.value}
							className={cn(
								'flex cursor-pointer items-start gap-2 rounded-md border p-3 font-normal',
								values.builder === builder.value && 'border-primary bg-primary/5'
							)}
						>
							<RadioGroupItem value={builder.value} className="mt-0.5" />
							<span>
								<span className="block text-sm font-medium">{builder.label}</span>
								<span className="text-xs text-muted-foreground">{builder.description}</span>
							</span>
						</Label>
					))}
				</RadioGroup>
				{values.builder === 'dockerfile' ? (
					<TextSetting
						label="Dockerfile path"
						value={values.dockerfilePath}
						onValueChange={dockerfilePath => set({ dockerfilePath })}
						mono
						placeholder="Dockerfile"
						hint="Relative to the repository (or root directory)."
					/>
				) : (
					<div className="grid gap-3 @md:grid-cols-2">
						<TextSetting
							label="Build command"
							value={values.buildCommand}
							onValueChange={buildCommand => set({ buildCommand })}
							mono
							placeholder="npm run build"
							hint="Overrides the detected build."
						/>
						<TextSetting
							label="Start command"
							value={values.startCommand}
							onValueChange={startCommand => set({ startCommand })}
							mono
							placeholder="node dist/server.js"
							hint="Overrides the detected start."
						/>
					</div>
				)}
			</Group>
			<Group
				title="Auto-deploy"
				description="Deploys when a new commit lands on the branch. The platform polls the repository; linked apps also push webhooks."
			>
				<ToggleSetting
					label="Deploy on push"
					hint={
						poll.lastPollError
							? `Last check failed: ${poll.lastPollError}`
							: poll.lastPolledCommit
								? `Last seen commit ${poll.lastPolledCommit.slice(0, 7)}, checked ${formatRelative(poll.lastPolledAt)}.`
								: `New commits on ${values.branch || 'the branch'} trigger a deploy.`
					}
					checked={values.autoDeploy.enabled}
					onCheckedChange={enabled => set({ autoDeploy: { enabled } })}
				/>
				{values.autoDeploy.enabled && (
					<>
						<ToggleSetting
							label="Watch the entire repository"
							hint="Ignore the root directory and watch paths; deploy on any commit."
							checked={values.watchEntireRepo}
							onCheckedChange={watchEntireRepo => set({ watchEntireRepo })}
						/>
						{!values.watchEntireRepo && (
							<div className="space-y-1.5">
								<Label className="text-xs">Additional watch paths</Label>
								<Textarea
									value={values.watchPaths}
									onChange={event => set({ watchPaths: event.target.value })}
									className="min-h-20 font-mono text-xs"
									placeholder={'packages/shared\npackages/db'}
									spellCheck={false}
								/>
								<p className="text-[11px] text-muted-foreground">
									One repository path per line. Commits under {root ? <code className="font-mono">{root}</code> : 'the root directory'} or these paths
									deploy.
								</p>
							</div>
						)}
					</>
				)}
			</Group>
		</>
	);
}
