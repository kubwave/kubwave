<script setup lang="ts">
import { MoreVertical, Search, ShieldCheck, ShieldOff, Trash2, UserPlus, Users } from 'lucide-vue-next';
import { formatRelative } from '~/utils/format';
import type { AdminUser } from '~/composables/use-admin-users';

const PAGE_SIZE = 10;

const { users, usersPending } = useAdminUsersData();
const { user: me } = useAuth();
const confirm = useConfirm();
const { busyUserId, toggleAdmin, deleteUser } = useAdminUserActions();

const search = ref('');
const inviteOpen = ref(false);

const filtered = computed<AdminUser[]>(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return users.value;
	return users.value.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
});

const { page, pageCount, paged } = usePagedList(filtered, PAGE_SIZE);

// Jump back to the first page when the search changes (but not on background refetches).
watch(search, () => {
	page.value = 1;
});

async function handleDeleteUser(target: AdminUser) {
	const confirmed = await confirm({
		title: 'Delete user',
		description: `Delete ${target.email}? This permanently removes their account and revokes all their sessions. This cannot be undone.`,
		confirmLabel: 'Delete user',
		destructive: true
	});
	if (!confirmed) return;
	deleteUser.mutate({ id: target.id, email: target.email });
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<div class="relative w-full sm:max-w-xs">
			<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input v-model="search" placeholder="Search members…" class="pl-9" :disabled="usersPending" />
		</div>

		<div class="overflow-hidden rounded-xl border bg-card shadow-xs">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead class="text-xs">User</TableHead>
						<TableHead class="text-xs">Email</TableHead>
						<TableHead class="text-xs">Role</TableHead>
						<TableHead class="text-xs">Joined</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					<template v-if="usersPending && paged.length === 0">
						<TableRow v-for="i in 5" :key="`skeleton-${i}`" class="hover:bg-transparent">
							<TableCell class="py-3">
								<div class="flex items-center gap-3">
									<Skeleton class="size-8 shrink-0 rounded-full" />
									<Skeleton class="h-3.5 w-28" />
								</div>
							</TableCell>
							<TableCell class="py-3"><Skeleton class="h-3.5 w-40" /></TableCell>
							<TableCell class="py-3"><Skeleton class="h-5 w-16 rounded-full" /></TableCell>
							<TableCell class="py-3"><Skeleton class="h-3.5 w-20" /></TableCell>
							<TableCell class="py-3" />
						</TableRow>
					</template>
					<TableRow v-else-if="paged.length === 0" class="hover:bg-transparent">
						<TableCell colspan="5" class="p-0">
							<EmptyState
								v-if="search"
								variant="inline"
								:icon="Search"
								title="No members match your search."
								description="Try a different name or email."
							/>
							<EmptyState
								v-else
								variant="inline"
								:icon="Users"
								title="No members yet."
								description="Invite teammates to give them access to the platform."
							>
								<template #action>
									<Button @click="inviteOpen = true">
										<UserPlus />
										Invite user
									</Button>
								</template>
							</EmptyState>
						</TableCell>
					</TableRow>
					<TableRow v-for="user in paged" v-else :key="user.id">
						<TableCell class="py-3">
							<div class="flex min-w-0 items-center gap-3">
								<UserAvatar :name="user.name" :email="user.email" />
								<div class="flex min-w-0 items-center gap-1.5">
									<span class="truncate text-sm font-medium">{{ user.name }}</span>
									<Badge v-if="user.id === me?.id" size="sm" variant="outline">You</Badge>
								</div>
							</div>
						</TableCell>
						<TableCell class="py-3 text-sm text-muted-foreground">{{ user.email }}</TableCell>
						<TableCell class="py-3">
							<Badge size="sm" :variant="user.isAdmin ? 'default' : 'secondary'">{{ user.isAdmin ? 'Admin' : 'Member' }}</Badge>
						</TableCell>
						<TableCell class="py-3 text-sm text-muted-foreground">{{ formatRelative(user.createdAt) }}</TableCell>
						<TableCell class="py-3 text-right">
							<DropdownMenu v-if="user.id !== me?.id">
								<DropdownMenuTrigger as-child>
									<Button
										variant="ghost"
										size="icon"
										class="size-8 text-muted-foreground"
										:disabled="busyUserId === user.id"
										aria-label="Member actions"
									>
										<MoreVertical />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" class="w-44">
									<DropdownMenuItem v-if="user.isAdmin" @select="toggleAdmin.mutate({ id: user.id, isAdmin: false })">
										<ShieldOff />
										Remove admin
									</DropdownMenuItem>
									<DropdownMenuItem v-else @select="toggleAdmin.mutate({ id: user.id, isAdmin: true })">
										<ShieldCheck />
										Make admin
									</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" @select="handleDeleteUser(user)">
										<Trash2 />
										Delete user
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>

		<TablePager v-model:page="page" :page-count="pageCount" />

		<AdminInviteUserModal v-model:open="inviteOpen" />
	</div>
</template>
