<script setup lang="ts">
import type { Environment } from '~/utils/types';

// Create a new environment, or rename an existing one (when `environment` is set).
const props = defineProps<{ projectId: string; environment?: Environment | null }>();
const emit = defineEmits<{ saved: [Environment] }>();
const open = defineModel<boolean>('open', { default: false });

const isRename = computed(() => Boolean(props.environment));
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-sm">
			<DialogHeader>
				<DialogTitle>{{ isRename ? 'Rename environment' : 'New environment' }}</DialogTitle>
				<DialogDescription>
					{{ isRename ? 'Give this environment a new name.' : 'Environments isolate a deployment of your services (e.g. production, staging).' }}
				</DialogDescription>
			</DialogHeader>
			<EnvironmentForm
				:key="environment?.id ?? 'create'"
				:project-id="projectId"
				:environment="environment"
				@saved="env => emit('saved', env)"
				@done="open = false"
			/>
		</DialogContent>
	</Dialog>
</template>
