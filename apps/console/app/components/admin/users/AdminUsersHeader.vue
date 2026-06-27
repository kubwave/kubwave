<script setup lang="ts">
import { UserPlus } from 'lucide-vue-next';

const open = ref(false);
</script>

<template>
	<PageHeader title="Users" description="Manage platform users and invitations.">
		<template #actions>
			<Button @click="open = true">
				<UserPlus />
				Invite user
			</Button>
		</template>
	</PageHeader>
	<AdminInviteUserModal v-model:open="open" />
</template>
