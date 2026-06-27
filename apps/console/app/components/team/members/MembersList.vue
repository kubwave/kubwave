<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { LogOut, MoreVertical, ShieldCheck, User, UserMinus, Users } from 'lucide-vue-next';
import { queryKeys } from '~/utils/query-keys';
import { formatRelative } from '~/utils/format';
import type { TeamMember } from '~/utils/types';

const props = defineProps<{ activeTeamId: string | null; isOwner: boolean }>();

function memberErrorMessage(error: string): string {
	switch (error) {
		case 'last_owner':
			return 'A team must keep at least one owner. Delete the team in Settings instead.';
		case 'team_forbidden':
			return 'Only owners can do that.';
		case 'member_not_found':
			return 'That member is no longer in the team.';
		case 'team_not_found':
			return 'This team is no longer available to you.';
		default:
			return 'Something went wrong. Please try again.';
	}
}

const { user } = useAuth();
const { activeTeam, isPending: teamsLoading } = useTeamContext();
const api = useApi();
const queryClient = useQueryClient();
const confirm = useConfirm();
const toast = useToast();
const busyUserId = ref<string | null>(null);

const activeTeamIdRef = computed(() => props.activeTeamId);
const { data: members, isPending: membersLoading } = useTeamMembers(activeTeamIdRef);

const isLoading = computed(() => teamsLoading.value || (!!props.activeTeamId && membersLoading.value));
const memberList = computed<TeamMember[]>(() => members.value ?? []);

const ownerCount = computed(() => memberList.value.filter(m => m.role === 'owner').length);

async function handleChangeRole(m: TeamMember, role: 'owner' | 'member') {
	if (!props.activeTeamId) return;

	busyUserId.value = m.userId;

	try {
		const updated = await apiData(api.teams(props.activeTeamId).members(m.userId).patch({ role })).catch(err => {
			toast.error('Could not update role', memberErrorMessage(errorCode(err)));
			return null;
		});
		if (!updated) return;

		await queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(props.activeTeamId) });
		toast.success('Role updated', `${m.name} is now ${role === 'owner' ? 'an owner' : 'a member'}.`);
	} catch {
		toast.error('Could not update role', 'Could not reach the server.');
	} finally {
		busyUserId.value = null;
	}
}

async function handleRemoveMember(m: TeamMember) {
	if (!props.activeTeamId || !activeTeam.value) return;

	const isSelf = m.userId === user.value?.id;
	const lastOwner = m.role === 'owner' && ownerCount.value === 1;

	if (lastOwner) return;

	const confirmed = await confirm({
		title: isSelf ? 'Leave team' : 'Remove member',
		description: isSelf
			? `Leave ${activeTeam.value.name}? You'll lose access to this team until someone adds you back.`
			: `Remove ${m.name} from ${activeTeam.value.name}? They'll lose access until added back.`,
		confirmLabel: isSelf ? 'Leave team' : 'Remove member',
		destructive: true
	});

	if (!confirmed) return;

	busyUserId.value = m.userId;

	try {
		const removed = await apiData(api.teams(props.activeTeamId).members(m.userId).delete()).catch(err => {
			toast.error(isSelf ? 'Could not leave team' : 'Could not remove member', memberErrorMessage(errorCode(err)));
			return null;
		});
		if (!removed) return;

		await queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(props.activeTeamId) });

		if (isSelf) {
			toast.success('You left the team', `You are no longer in ${activeTeam.value.name}.`);
			await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
		} else {
			toast.success('Member removed', `${m.name} was removed from the team.`);
		}
	} catch {
		toast.error(isSelf ? 'Could not leave team' : 'Could not remove member', 'Could not reach the server.');
	} finally {
		busyUserId.value = null;
	}
}

function rowMeta(m: TeamMember) {
	const isSelf = m.userId === user.value?.id;
	const lastOwner = m.role === 'owner' && ownerCount.value === 1;
	const isBusy = busyUserId.value === m.userId;
	const canChangeRole = props.isOwner;
	const canRemove = isSelf || props.isOwner;
	const showActions = canChangeRole || canRemove;

	return { isSelf, lastOwner, isBusy, showActions };
}
</script>

<template>
	<Card class="gap-0 overflow-hidden py-0">
		<CardHeader class="border-b py-4">
			<div class="flex flex-row items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="text-base font-semibold">Members</span>
					<Badge v-if="memberList.length > 0" variant="secondary" class="tabular-nums">{{ memberList.length }}</Badge>
				</div>
				<slot name="action" />
			</div>
		</CardHeader>

		<div v-if="isLoading" class="divide-y">
			<div v-for="i in 3" :key="i" class="flex items-center gap-3 px-6 py-3.5">
				<Skeleton class="size-7 rounded-full" />
				<div class="flex flex-1 flex-col gap-1.5">
					<Skeleton class="h-3.5 w-32" />
					<Skeleton class="h-3 w-48" />
				</div>
			</div>
		</div>

		<div v-else-if="!activeTeam" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
			<Users class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No team selected.</p>
		</div>

		<EmptyState
			v-else-if="memberList.length === 0"
			variant="inline"
			:icon="Users"
			title="No members yet"
			description="Add people to this team so they can access its projects."
		>
			<template v-if="isOwner" #action>
				<slot name="action" />
			</template>
		</EmptyState>

		<ul v-else class="divide-y">
			<li v-for="m in memberList" :key="m.userId" class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
				<div class="flex min-w-0 items-center gap-3">
					<UserAvatar :name="m.name" :email="m.email" class="size-7" />
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-1.5">
							<span class="truncate text-sm font-medium">{{ m.name }}</span>
							<Badge :variant="m.role === 'owner' ? 'default' : 'secondary'" class="shrink-0">
								{{ m.role === 'owner' ? 'Owner' : 'Member' }}
							</Badge>
							<Badge v-if="m.userId === user?.id" variant="outline" class="shrink-0">You</Badge>
						</div>
						<p class="mt-0.5 truncate text-xs text-muted-foreground">{{ m.email }} &middot; joined {{ formatRelative(m.joinedAt) }}</p>
					</div>
				</div>

				<DropdownMenu v-if="rowMeta(m).showActions">
					<DropdownMenuTrigger as-child>
						<Button
							variant="ghost"
							size="icon"
							class="size-8 shrink-0 text-muted-foreground"
							:disabled="rowMeta(m).isBusy"
							aria-label="Member actions"
						>
							<MoreVertical />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" class="w-44">
						<DropdownMenuItem v-if="isOwner && m.role === 'member'" @select="() => handleChangeRole(m, 'owner')">
							<ShieldCheck />
							Make owner
						</DropdownMenuItem>
						<DropdownMenuItem
							v-if="isOwner && m.role === 'owner'"
							:disabled="rowMeta(m).lastOwner"
							@select="() => !rowMeta(m).lastOwner && handleChangeRole(m, 'member')"
						>
							<User />
							Make member
						</DropdownMenuItem>
						<DropdownMenuItem
							v-if="rowMeta(m).isSelf"
							variant="destructive"
							:disabled="rowMeta(m).lastOwner"
							@select="() => !rowMeta(m).lastOwner && handleRemoveMember(m)"
						>
							<LogOut />
							Leave team
						</DropdownMenuItem>
						<DropdownMenuItem
							v-if="!rowMeta(m).isSelf && isOwner"
							variant="destructive"
							:disabled="rowMeta(m).lastOwner"
							@select="() => !rowMeta(m).lastOwner && handleRemoveMember(m)"
						>
							<UserMinus />
							Remove from team
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</li>
		</ul>
	</Card>
</template>
