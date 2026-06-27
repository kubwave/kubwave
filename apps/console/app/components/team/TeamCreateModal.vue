<script setup lang="ts">
import { Users } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ created: [{ id: string; name: string }] }>();
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="max-w-md">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<Users class="size-4 text-primary" />
					Create team
				</DialogTitle>
				<DialogDescription>Group projects and members under a shared team.</DialogDescription>
			</DialogHeader>
			<TeamCreateForm @created="team => emit('created', team)" @done="open = false" />
		</DialogContent>
	</Dialog>
</template>
