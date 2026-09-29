'use client';

import { CheckCircle2Icon, LogOutIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-provider';
import { CopyButton } from '@/components/copy-button';
import { SettingsCard } from '@/components/settings-layout';
import { DangerRow, InfoItem, WithTooltip } from '@/components/settings/parts';
import { SaveBar } from '@/components/settings/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/session-provider';
import type { TeamSummary } from '@/features/team/use-teams';
import { errorCode } from '@/lib/api/api-error';
import type { TeamMember } from '@/lib/api/types';
import { teamErrorMessage } from '@/lib/team-errors';
import { memberErrorMessage } from './errors';
import { useDeleteTeam, useLeaveTeam, useRenameTeam } from './use-team-settings';

const MAX_NAME_LENGTH = 100;

export function RoleBadge({ role }: { role: TeamMember['role'] }) {
	return (
		<Badge variant="outline" className={role === 'owner' ? '' : 'text-muted-foreground'}>
			{role === 'owner' ? 'Owner' : 'Member'}
		</Badge>
	);
}

export function GeneralSection({ team, members }: { team: TeamSummary; members: TeamMember[] | undefined }) {
	const isOwner = team.role === 'owner';
	return (
		<>
			<RenameCard team={team} isOwner={isOwner} />
			<SettingsCard title="Team info">
				<dl className="grid gap-5 sm:grid-cols-3">
					<InfoItem label="Team ID">
						<code className="truncate font-mono text-xs">{team.id}</code>
						<CopyButton value={team.id} label="Copy team ID" />
					</InfoItem>
					<InfoItem label="Your role">
						<RoleBadge role={team.role} />
					</InfoItem>
					<InfoItem label="Members">{members ? <span className="tabular-nums">{members.length}</span> : <Skeleton className="h-4 w-6" />}</InfoItem>
					<InfoItem label="Member since">
						<span suppressHydrationWarning>{new Date(team.joinedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}</span>
					</InfoItem>
					<InfoItem label="Default team">
						{team.isDefault ? (
							<Badge variant="secondary" className="text-[11px]">
								<CheckCircle2Icon className="text-success" />
								Default
							</Badge>
						) : (
							<span className="text-muted-foreground">No</span>
						)}
					</InfoItem>
				</dl>
			</SettingsCard>
			<DangerZone team={team} members={members} />
		</>
	);
}

function RenameCard({ team, isOwner }: { team: TeamSummary; isOwner: boolean }) {
	const [name, setName] = useState(team.name);
	const rename = useRenameTeam(team.id);
	const trimmed = name.trim();
	const tooLong = trimmed.length > MAX_NAME_LENGTH;
	const changed = trimmed !== team.name;
	const canSave = isOwner && changed && trimmed.length > 0 && !tooLong;

	const save = async () => {
		if (!canSave) return;
		try {
			await rename.mutateAsync(trimmed);
			toast.success('Team renamed', { description: `Renamed to ${trimmed}.` });
		} catch (err) {
			toast.error('Could not rename team', { description: teamErrorMessage(errorCode(err)) });
		}
	};

	return (
		<>
			<SettingsCard
				title="Team name"
				description="Shown in the team switcher and when scoping MCP tokens."
				footer={
					<>
						<p className="mr-auto text-xs text-muted-foreground">
							{isOwner ? `Up to ${MAX_NAME_LENGTH} characters.` : 'Only owners can rename the team.'}
						</p>
						<Button size="sm" disabled={!canSave || rename.isPending} onClick={() => void save()}>
							Save
						</Button>
					</>
				}
			>
				<Label htmlFor="team-name" className="sr-only">
					Team name
				</Label>
				<Input
					id="team-name"
					value={name}
					disabled={!isOwner}
					aria-invalid={tooLong || !trimmed || undefined}
					onChange={event => setName(event.target.value)}
					onKeyDown={event => event.key === 'Enter' && void save()}
					className="max-w-sm"
				/>
				{(tooLong || !trimmed) && (
					<p className="mt-2 text-xs text-destructive">
						{tooLong ? `Team name must be ${MAX_NAME_LENGTH} characters or fewer.` : 'Enter a team name.'}
					</p>
				)}
			</SettingsCard>
			<SaveBar changes={isOwner && changed ? 1 : 0} pending={rename.isPending} onDiscard={() => setName(team.name)} onSave={() => void save()} />
		</>
	);
}

function DangerZone({ team, members }: { team: TeamSummary; members: TeamMember[] | undefined }) {
	const router = useRouter();
	const confirm = useConfirm();
	const { user } = useSession();
	const leave = useLeaveTeam(team.id);
	const deleteTeam = useDeleteTeam(team.id);
	const isOwner = team.role === 'owner';
	const soleOwner = isOwner && (members?.filter(member => member.role === 'owner').length ?? 0) <= 1;

	const onLeave = async () => {
		if (!user) return;
		const confirmed = await confirm({
			title: `Leave ${team.name}?`,
			description: "You'll lose access to this team until someone adds you back.",
			confirmLabel: 'Leave team',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await leave.mutateAsync(user.id);
			toast.success('You left the team', { description: `You are no longer in ${team.name}.` });
			router.push('/');
		} catch (err) {
			toast.error('Could not leave team', { description: memberErrorMessage(errorCode(err)) });
		}
	};

	const onDelete = async () => {
		const confirmed = await confirm({
			title: `Delete ${team.name}?`,
			description: `This permanently deletes ${team.name} and removes all of its members. This cannot be undone.`,
			confirmLabel: 'Delete team',
			destructive: true,
			confirmationText: team.name
		});
		if (!confirmed) return;
		try {
			await deleteTeam.mutateAsync();
			toast.success('Team deleted', { description: `${team.name} has been deleted.` });
			router.push('/');
		} catch (err) {
			toast.error('Could not delete team', { description: teamErrorMessage(errorCode(err)) });
		}
	};

	return (
		<SettingsCard title="Danger zone" tone="danger">
			<div className="divide-y">
				<DangerRow title="Leave team" description={`You will lose access to every project in ${team.name}.`}>
					<WithTooltip tip={soleOwner && 'You are the only owner. Make someone else an owner first.'}>
						<Button
							variant="outline"
							size="sm"
							disabled={soleOwner || leave.isPending}
							className="text-destructive hover:text-destructive"
							onClick={() => void onLeave()}
						>
							<LogOutIcon />
							Leave team
						</Button>
					</WithTooltip>
				</DangerRow>
				<DangerRow title="Delete team" description="Permanently removes the team and all of its memberships.">
					<WithTooltip tip={!isOwner && 'Only owners can delete the team.'}>
						<Button variant="destructive" size="sm" disabled={!isOwner || deleteTeam.isPending} onClick={() => void onDelete()}>
							<Trash2Icon />
							{deleteTeam.isPending ? 'Deleting…' : 'Delete team'}
						</Button>
					</WithTooltip>
				</DangerRow>
			</div>
		</SettingsCard>
	);
}
