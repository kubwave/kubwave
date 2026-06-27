<script setup lang="ts">
import { UserPlus } from 'lucide-vue-next';

// Exposes v-model:open; the form's `done` closes the modal.
defineProps<{ teamId: string }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-sm">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<UserPlus class="size-4 text-primary" />
					Add member
				</DialogTitle>
				<DialogDescription>The person must already have an account.</DialogDescription>
			</DialogHeader>
			<TeamAddMemberForm :team-id="teamId" @done="open = false" />
		</DialogContent>
	</Dialog>
</template>
