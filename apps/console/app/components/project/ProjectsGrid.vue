<script setup lang="ts">
import { FolderPlus } from 'lucide-vue-next';
import type { ProjectListItem } from '~/composables/use-project-data';

const props = defineProps<{ activeTeamId: string | null }>();
const createOpen = ref(false);
const activeTeamId = computed(() => props.activeTeamId);
const { data: projects, isPending } = useTeamProjects(activeTeamId);
</script>

<template>
	<div v-if="isPending" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		<Skeleton v-for="i in 3" :key="i" class="h-40 rounded-xl" />
	</div>

	<EmptyState v-else-if="!activeTeamId" :icon="FolderPlus" title="No team selected" description="Select a team to view its projects." />

	<EmptyState
		v-else-if="!projects || projects.length === 0"
		:icon="FolderPlus"
		title="No projects yet"
		description="Create your first project to get started."
	>
		<template #action>
			<Button size="sm" @click="createOpen = true"><FolderPlus /> Create project</Button>
		</template>
	</EmptyState>

	<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		<ProjectCard v-for="project in projects as ProjectListItem[]" :key="project.id" :project="project" />
	</div>

	<ProjectCreateModal v-if="activeTeamId" v-model:open="createOpen" :team-id="activeTeamId" />
</template>
