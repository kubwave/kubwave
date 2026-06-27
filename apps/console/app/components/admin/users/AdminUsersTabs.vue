<script setup lang="ts">
import { Mail, Users } from 'lucide-vue-next';

const { users, pendingInvitations } = useAdminUsersData();

const tab = ref('members');
</script>

<template>
	<div class="flex flex-col gap-6">
		<Tabs v-model="tab" class="w-full">
			<TabsList>
				<TabsTrigger value="members">
					<Users class="size-4" />
					Members
					<Badge v-if="users.length > 0" variant="secondary" class="tabular-nums">{{ users.length }}</Badge>
				</TabsTrigger>
				<TabsTrigger value="invitations">
					<Mail class="size-4" />
					Invitations
					<Badge v-if="pendingInvitations.length > 0" variant="secondary" class="tabular-nums">{{ pendingInvitations.length }}</Badge>
				</TabsTrigger>
			</TabsList>
		</Tabs>

		<AdminUsersMembersTable v-if="tab === 'members'" />
		<AdminUsersInvitationsTable v-else-if="tab === 'invitations'" />
	</div>
</template>
