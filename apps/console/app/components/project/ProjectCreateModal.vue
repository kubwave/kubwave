<script setup lang="ts">
import { FolderPlus } from 'lucide-vue-next';

defineProps<{ teamId: string }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-md">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<FolderPlus class="size-4 text-primary" />
					Create project
				</DialogTitle>
				<DialogDescription>Group environments and services under a project.</DialogDescription>
			</DialogHeader>
			<ProjectCreateForm :team-id="teamId" @done="open = false" />
		</DialogContent>
	</Dialog>
</template>
