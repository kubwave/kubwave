<script setup lang="ts">
import { UserPlus } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-md">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<UserPlus class="size-4 text-primary" />
					Invite user
				</DialogTitle>
				<DialogDescription>Send an invitation to join the platform.</DialogDescription>
			</DialogHeader>
			<AdminInviteUserForm @done="open = false" />
		</DialogContent>
	</Dialog>
</template>
