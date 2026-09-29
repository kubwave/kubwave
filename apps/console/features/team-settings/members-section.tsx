'use client';

import { useForm } from '@tanstack/react-form';
import { EllipsisIcon, ShieldIcon, UserIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { useConfirm } from '@/components/confirm-provider';
import { FormError, FormField, SubmitButton } from '@/components/form-field';
import { EmptyRow, ListCard, LoadError, WithTooltip } from '@/components/settings/parts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/session-provider';
import { UserAvatar } from '@/features/shell/avatars';
import type { TeamSummary } from '@/features/team/use-teams';
import { errorCode } from '@/lib/api/api-error';
import type { TeamMember } from '@/lib/api/types';
import { formatRelative } from '@/lib/format';
import { addMemberError, memberErrorMessage } from './errors';
import { RoleBadge } from './general-section';
import { memberActions } from './model';
import { useMemberMutations } from './use-team-settings';

export function MembersSection({
	team,
	members,
	loading,
	onRetry
}: {
	team: TeamSummary;
	members: TeamMember[] | undefined;
	loading: boolean;
	// Set when the member list failed to load.
	onRetry?: () => void;
}) {
	const { user } = useSession();
	const confirm = useConfirm();
	const { setRole, remove } = useMemberMutations(team.id);
	const [adding, setAdding] = useState(false);
	const isOwner = team.role === 'owner';
	const list = members ?? [];
	const ownerCount = list.filter(member => member.role === 'owner').length;
	const busy = (member: TeamMember) =>
		(setRole.isPending && setRole.variables.userId === member.userId) || (remove.isPending && remove.variables === member.userId);

	const changeRole = async (member: TeamMember, role: TeamMember['role']) => {
		try {
			await setRole.mutateAsync({ userId: member.userId, role });
			toast.success('Role updated', { description: `${member.name} is now ${role === 'owner' ? 'an owner' : 'a member'}.` });
		} catch (err) {
			toast.error('Could not update role', { description: memberErrorMessage(errorCode(err)) });
		}
	};

	const removeMember = async (member: TeamMember) => {
		const confirmed = await confirm({
			title: 'Remove member',
			description: `Remove ${member.name} from ${team.name}? They'll lose access until added back.`,
			confirmLabel: 'Remove member',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await remove.mutateAsync(member.userId);
			toast.success('Member removed', { description: `${member.name} was removed from the team.` });
		} catch (err) {
			toast.error('Could not remove member', { description: memberErrorMessage(errorCode(err)) });
		}
	};

	return (
		<>
			<ListCard
				title="Members"
				description={`${list.length} ${list.length === 1 ? 'person has' : 'people have'} access to ${team.name}. Owners can manage members and rename or delete the team.`}
				action={
					<WithTooltip tip={!isOwner && 'Only owners can add members.'}>
						<Button size="sm" disabled={!isOwner} onClick={() => setAdding(true)}>
							<UserPlusIcon />
							Add member
						</Button>
					</WithTooltip>
				}
			>
				{loading &&
					[0, 1, 2].map(i => (
						<li key={i} className="flex items-center gap-3 px-5 py-3">
							<Skeleton className="size-8 rounded-full" />
							<div className="grid flex-1 gap-1.5">
								<Skeleton className="h-3.5 w-32" />
								<Skeleton className="h-3 w-48" />
							</div>
						</li>
					))}
				{onRetry && (
					<li>
						<LoadError what="the members" onRetry={onRetry} />
					</li>
				)}
				{!loading && !onRetry && list.length === 0 && (
					<EmptyRow icon={UsersIcon} title="No members yet" description="Add people to this team so they can access its projects." />
				)}
				{list.map(member => {
					const actions = memberActions(member, { userId: user?.id, isOwner }, ownerCount);
					return (
						<li key={member.userId} className="flex items-center gap-3 px-5 py-3">
							<UserAvatar name={member.name} className="size-8" />
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium">{member.name}</span>
									{actions.isSelf && (
										<Badge variant="outline" className="px-1.5 py-0 text-[10px]">
											You
										</Badge>
									)}
								</div>
								<p className="truncate text-xs text-muted-foreground">
									{member.email} · joined {formatRelative(member.joinedAt)}
								</p>
							</div>
							<RoleBadge role={member.role} />
							{actions.canPromote || actions.canDemote || actions.canRemove ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm" disabled={busy(member)} aria-label={`Manage ${member.name}`}>
											<EllipsisIcon />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-48">
										{actions.canPromote && (
											<DropdownMenuItem onSelect={() => void changeRole(member, 'owner')}>
												<ShieldIcon />
												Make owner
											</DropdownMenuItem>
										)}
										{actions.canDemote && (
											<DropdownMenuItem disabled={actions.lastOwner} onSelect={() => void changeRole(member, 'member')}>
												<UserIcon />
												Make member
											</DropdownMenuItem>
										)}
										{actions.canRemove && (
											<>
												<DropdownMenuSeparator />
												<DropdownMenuItem variant="destructive" onSelect={() => void removeMember(member)}>
													<UserMinusIcon />
													Remove from team
												</DropdownMenuItem>
											</>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<span className="size-8" aria-hidden />
							)}
						</li>
					);
				})}
			</ListCard>
			<AddMemberDialog teamId={team.id} open={adding} onOpenChange={setAdding} />
		</>
	);
}

const addMemberSchema = z.object({ email: z.string().trim().min(1, 'Enter an email.').email('Enter a valid email address.') });

function AddMemberDialog({ teamId, open, onOpenChange }: { teamId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
	const { add } = useMemberMutations(teamId);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { email: '' },
		validators: { onSubmit: addMemberSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const member = await add.mutateAsync(value.email.trim());
				toast.success('Member added', { description: `${member.email} was added to the team.` });
				close();
			} catch (err) {
				const { title, description } = addMemberError(errorCode(err));
				setError(`${title}. ${description}`);
			}
		}
	});
	const close = () => {
		form.reset();
		setError(null);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
			<DialogContent className="sm:max-w-md">
				<form
					noValidate
					onSubmit={event => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="grid gap-4"
				>
					<DialogHeader>
						<DialogTitle>Add member</DialogTitle>
						<DialogDescription>They need an existing account on this kubwave instance and join as a Member.</DialogDescription>
					</DialogHeader>
					<form.Field name="email">
						{field => <FormField field={field} label="Email" type="email" autoFocus autoComplete="off" placeholder="teammate@example.com" />}
					</form.Field>
					<FormError message={error} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={close}>
							Cancel
						</Button>
						<form.Subscribe selector={state => state.isSubmitting}>
							{submitting => (
								<SubmitButton pending={submitting} className="w-auto">
									Add member
								</SubmitButton>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
