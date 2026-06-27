<script setup lang="ts">
import { Box, FolderKanban, FolderPlus, Layers, Plus, Users } from 'lucide-vue-next';
import type { ProjectListItem } from '~/composables/use-project-data';

// Team overview derived entirely from the one team-projects query — no extra round-trips.
const { activeTeamId, isPending: teamsPending } = useTeamContext();
const { data: projects, isPending: projectsPending } = useTeamProjects(activeTeamId);
const switchTeam = useSwitchTeam();
const createOpen = ref(false);

const list = computed<ProjectListItem[]>(() => projects.value ?? []);

const stats = computed(() => [
	{ label: 'Projects', value: list.value.length, icon: FolderKanban },
	{ label: 'Environments', value: list.value.reduce((n, p) => n + p.environmentCount, 0), icon: Layers },
	{ label: 'Services', value: list.value.reduce((n, p) => n + p.serviceCount, 0), icon: Box }
]);

const recent = computed(() => [...list.value].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6));
</script>

<template>
	<!-- No team: the team-projects query is disabled, so render a dedicated empty state
	     instead of skeletons that would otherwise spin forever. teamsPending guards the initial load. -->
	<EmptyState
		v-if="!teamsPending && !activeTeamId"
		:icon="Users"
		title="You're not in a team yet"
		description="Create a team to start adding projects, environments and services."
	>
		<template #action>
			<Button size="sm" @click="createOpen = true">
				<Plus />
				Create team
			</Button>
		</template>
	</EmptyState>

	<div v-else class="flex flex-col gap-6">
		<div class="grid gap-4 sm:grid-cols-3">
			<StatTile v-for="s in stats" :key="s.label" :label="s.label" :value="s.value" :icon="s.icon" :pending="projectsPending" />
		</div>

		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<h2 class="text-base font-semibold">Recent projects</h2>
				<NuxtLink to="/team/projects" class="text-sm text-primary-text hover:underline">View all</NuxtLink>
			</div>

			<div v-if="projectsPending" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Skeleton v-for="i in 3" :key="i" class="h-28 rounded-xl" />
			</div>

			<EmptyState v-else-if="recent.length === 0" :icon="FolderPlus" title="No projects yet" description="Create your first project to get started.">
				<template #action>
					<Button as-child size="sm">
						<NuxtLink to="/team/projects"><FolderPlus /> Go to projects</NuxtLink>
					</Button>
				</template>
			</EmptyState>

			<div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<ProjectCard v-for="project in recent" :key="project.id" :project="project" compact />
			</div>
		</section>
	</div>

	<TeamCreateModal v-model:open="createOpen" @created="team => switchTeam.mutate(team.id)" />
</template>
