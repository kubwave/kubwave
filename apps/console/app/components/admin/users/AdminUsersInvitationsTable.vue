<script setup lang="ts">
import { Mail, MoreVertical, Search, Send, X } from 'lucide-vue-next';
import { formatRelative } from '~/utils/format';
import type { Invitation } from '~/composables/use-admin-invitations';

const PAGE_SIZE = 10;

const { pendingInvitations, invitationsPending } = useAdminUsersData();
const { busyInviteId, resendInvite, revokeInvite } = useAdminInvitationActions();

const search = ref('');

const filtered = computed<Invitation[]>(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return pendingInvitations.value;
	return pendingInvitations.value.filter(i => i.email.toLowerCase().includes(q));
});

const { page, pageCount, paged } = usePagedList(filtered, PAGE_SIZE);

// Jump back to the first page when the search changes (but not on background refetches).
watch(search, () => {
	page.value = 1;
});
</script>

<template>
	<div class="flex flex-col gap-4">
		<div class="relative w-full sm:max-w-xs">
			<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				v-model="search"
				placeholder="Search invitations…"
				class="pl-9"
				:disabled="invitationsPending || (pendingInvitations.length === 0 && !search)"
			/>
		</div>

		<div v-if="pendingInvitations.length === 0 && !invitationsPending" class="rounded-xl border bg-card shadow-xs">
			<EmptyState
				variant="inline"
				:icon="Mail"
				title="No pending invitations."
				description="Invitations you send appear here until they’re accepted."
			/>
		</div>

		<div v-else class="overflow-hidden rounded-xl border bg-card shadow-xs">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead class="text-xs">Email</TableHead>
						<TableHead class="text-xs">Role</TableHead>
						<TableHead class="text-xs">Status</TableHead>
						<TableHead class="text-xs">Invited</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					<template v-if="invitationsPending && paged.length === 0">
						<TableRow v-for="i in 5" :key="`skeleton-${i}`" class="hover:bg-transparent">
							<TableCell class="py-3"><Skeleton class="h-3.5 w-44" /></TableCell>
							<TableCell class="py-3"><Skeleton class="h-5 w-16 rounded-full" /></TableCell>
							<TableCell class="py-3"><Skeleton class="h-5 w-16 rounded-full" /></TableCell>
							<TableCell class="py-3"><Skeleton class="h-3.5 w-32" /></TableCell>
							<TableCell class="py-3" />
						</TableRow>
					</template>
					<TableRow v-else-if="paged.length === 0" class="hover:bg-transparent">
						<TableCell colspan="5" class="p-0">
							<EmptyState variant="inline" :icon="Search" title="No invitations match your search." description="Try a different email." />
						</TableCell>
					</TableRow>
					<TableRow v-for="invite in paged" v-else :key="invite.id">
						<TableCell class="py-3 text-sm font-medium">{{ invite.email }}</TableCell>
						<TableCell class="py-3">
							<Badge size="sm" :variant="invite.isAdmin ? 'default' : 'secondary'">{{ invite.isAdmin ? 'Admin' : 'Member' }}</Badge>
						</TableCell>
						<TableCell class="py-3">
							<Badge size="sm" :variant="invite.status === 'expired' ? 'destructive' : 'secondary'" class="capitalize">{{ invite.status }}</Badge>
						</TableCell>
						<TableCell class="py-3 text-sm text-muted-foreground">
							{{ formatRelative(invite.createdAt) }} &middot; expires {{ formatRelative(invite.expiresAt) }}
						</TableCell>
						<TableCell class="py-3 text-right">
							<DropdownMenu>
								<DropdownMenuTrigger as-child>
									<Button
										variant="ghost"
										size="icon"
										class="size-8 text-muted-foreground"
										:disabled="busyInviteId === invite.id"
										aria-label="Invitation actions"
									>
										<MoreVertical />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" class="w-44">
									<DropdownMenuItem @select="resendInvite.mutate(invite.id)">
										<Send />
										Resend
									</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" @select="revokeInvite.mutate(invite.id)">
										<X />
										Revoke
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>

		<TablePager v-model:page="page" :page-count="pageCount" />
	</div>
</template>
