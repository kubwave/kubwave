<script setup lang="ts">
import { Box, FolderKanban, FolderPlus, Layers, Plus, UserPlus, Users } from 'lucide-vue-next';
import type { ProjectListItem } from '~/composables/use-project-data';

// Team overview: stats + quick actions + recent projects + team-wide deployment feed.
const { activeTeamId, isPending: teamsPending } = useTeamContext();
const { data: projects, isPending: projectsPending } = useTeamProjects(activeTeamId);
const { data: deployments, isPending: deploymentsPending } = useTeamDeployments(activeTeamId);
const switchTeam = useSwitchTeam();
const teamCreateOpen = ref(false);
const projectCreateOpen = ref(false);

const list = computed<ProjectListItem[]>(() => projects.value ?? []);

const stats = computed(() => [
	{ label: 'Projects', value: list.value.length, icon: FolderKanban, to: '/team/projects' },
	{ label: 'Environments', value: list.value.reduce((n, p) => n + p.environmentCount, 0), icon: Layers, to: '/team/projects' },
	{ label: 'Services', value: list.value.reduce((n, p) => n + p.serviceCount, 0), icon: Box, to: '/team/projects' }
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
			<Button size="sm" @click="teamCreateOpen = true">
				<Plus />
				Create team
			</Button>
		</template>
	</EmptyState>

	<div v-else class="flex flex-col gap-6">
		<div class="grid gap-4 sm:grid-cols-3">
			<StatTile v-for="s in stats" :key="s.label" :label="s.label" :value="s.value" :icon="s.icon" :to="s.to" :pending="projectsPending" />
		</div>

		<div class="flex items-center gap-2">
			<Button size="sm" @click="projectCreateOpen = true">
				<FolderPlus />
				New project
			</Button>
			<Button as-child size="sm" variant="outline">
				<NuxtLink to="/team/settings?tab=members"><UserPlus /> Invite member</NuxtLink>
			</Button>
		</div>

		<div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
			<section class="flex flex-col gap-3 xl:col-span-2">
				<div class="flex items-center justify-between">
					<h2 class="text-base font-semibold">Recent projects</h2>
					<NuxtLink to="/team/projects" class="text-sm text-primary-text hover:underline">View all</NuxtLink>
				</div>

				<div v-if="projectsPending" class="grid gap-4 sm:grid-cols-2">
					<Skeleton v-for="i in 3" :key="i" class="h-28 rounded-xl" />
				</div>

				<EmptyState
					v-else-if="recent.length === 0"
					:icon="FolderPlus"
					title="No projects yet"
					description="Create your first project to get started."
				>
					<template #action>
						<Button size="sm" @click="projectCreateOpen = true"><FolderPlus /> New project</Button>
					</template>
				</EmptyState>

				<div v-else class="grid gap-4 sm:grid-cols-2">
					<ProjectCard v-for="project in recent" :key="project.id" :project="project" compact />
				</div>
			</section>

			<DashboardActivity :items="deployments ?? []" :pending="deploymentsPending" />
		</div>
	</div>

	<TeamCreateModal v-model:open="teamCreateOpen" @created="team => switchTeam.mutate(team.id)" />
	<ProjectCreateModal v-if="activeTeamId" v-model:open="projectCreateOpen" :team-id="activeTeamId" />
</template>
