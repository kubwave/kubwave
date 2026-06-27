<script setup lang="ts">
import { Settings2 } from 'lucide-vue-next';
import type { ProjectDetail } from '~/utils/types';

defineProps<{ project: ProjectDetail }>();

const open = ref(false);
</script>

<template>
	<Button variant="outline" size="sm" class="shrink-0" @click="open = true">
		<Settings2 />
		Settings
	</Button>
	<ProjectSettingsModal v-model:open="open" :project="project" />
</template>
