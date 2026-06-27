<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next';

// Exposes v-model:open; the form's `done` closes the modal.
defineProps<{ teamId: string }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-lg">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<KeyRound class="size-4 text-primary" />
					Add SSH key
				</DialogTitle>
				<DialogDescription>Generate a new deploy key or upload an existing private key.</DialogDescription>
			</DialogHeader>
			<TeamAddSshKeyForm :team-id="teamId" @done="open = false" />
		</DialogContent>
	</Dialog>
</template>
