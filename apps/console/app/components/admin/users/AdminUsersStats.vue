<script setup lang="ts">
import { Mail, ShieldCheck, Users } from 'lucide-vue-next';

// Three at-a-glance tiles over the same cached queries the tables read.
const { users, adminCount, pendingInvitations, usersPending, invitationsPending } = useAdminUsersData();

const tiles = computed(() => [
	{ label: 'Members', value: users.value.length, icon: Users, pending: usersPending.value },
	{ label: 'Admins', value: adminCount.value, icon: ShieldCheck, pending: usersPending.value },
	{ label: 'Pending invitations', value: pendingInvitations.value.length, icon: Mail, pending: invitationsPending.value }
]);
</script>

<template>
	<div class="grid gap-4 sm:grid-cols-3">
		<StatTile v-for="tile in tiles" :key="tile.label" :label="tile.label" :value="tile.value" :icon="tile.icon" :pending="tile.pending" />
	</div>
</template>
