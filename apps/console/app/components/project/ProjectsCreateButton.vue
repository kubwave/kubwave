<script setup lang="ts">
import { FolderPlus } from 'lucide-vue-next';

const props = defineProps<{ activeTeamId: string | null }>();
const open = ref(false);
</script>

<template>
	<div>
		<Button :disabled="!props.activeTeamId" class="shrink-0" @click="open = true">
			<FolderPlus />
			Create project
		</Button>
		<ProjectCreateModal v-if="props.activeTeamId" v-model:open="open" :team-id="props.activeTeamId" />
	</div>
</template>
