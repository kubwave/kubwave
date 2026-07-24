<script setup lang="ts">
import { FolderKanban, FolderPlus, LayoutGrid, List, Search } from 'lucide-vue-next';
import type { ProjectListItem } from '~/composables/use-project-data';
import { formatRelative } from '~/utils/format';

const props = defineProps<{ activeTeamId: string | null }>();
const createOpen = ref(false);
const activeTeamId = computed(() => props.activeTeamId);
const { data: projects, isPending } = useTeamProjects(activeTeamId);

const search = ref('');
const sort = ref<'recent' | 'name'>('recent');
const layout = ref<'grid' | 'list'>('grid');

const filtered = computed<ProjectListItem[]>(() => {
	const q = search.value.trim().toLowerCase();
	let items = projects.value ?? [];
	if (q) items = items.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
	return [...items].sort((a, b) => (sort.value === 'name' ? a.name.localeCompare(b.name) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
});
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

	<div v-else class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center gap-2">
			<div class="relative">
				<Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input v-model="search" type="search" placeholder="Search projects…" class="h-8 w-56 pl-8 text-sm" />
			</div>
			<Select v-model="sort">
				<SelectTrigger class="h-8 w-44 text-sm">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="recent">Recently updated</SelectItem>
					<SelectItem value="name">Name</SelectItem>
				</SelectContent>
			</Select>
			<div class="ml-auto flex items-center gap-0.5 rounded-md border bg-background p-0.5">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					:class="['size-7', layout === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground']"
					title="Grid view"
					@click="layout = 'grid'"
				>
					<LayoutGrid />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					:class="['size-7', layout === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground']"
					title="List view"
					@click="layout = 'list'"
				>
					<List />
				</Button>
			</div>
		</div>

		<EmptyState
			v-if="filtered.length === 0"
			variant="inline"
			:icon="Search"
			title="No projects match your search"
			description="Try a different name or description."
		/>

		<div v-else-if="layout === 'grid'" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			<ProjectCard v-for="project in filtered" :key="project.id" :project="project" />
		</div>

		<div v-else class="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
			<NuxtLink
				v-for="project in filtered"
				:key="project.id"
				:to="`/team/projects/${project.id}`"
				class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60"
			>
				<span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground/70">
					<FolderKanban class="size-4" />
				</span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{{ project.name }}</p>
					<p class="truncate text-xs text-muted-foreground">{{ project.description || 'No description' }}</p>
				</div>
				<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
					{{ project.environmentCount }} {{ project.environmentCount === 1 ? 'env' : 'envs' }} · {{ project.serviceCount }}
					{{ project.serviceCount === 1 ? 'svc' : 'svcs' }}
				</span>
				<span class="w-20 shrink-0 text-right text-xs text-muted-subtle">{{ formatRelative(project.updatedAt) }}</span>
			</NuxtLink>
		</div>
	</div>

	<ProjectCreateModal v-if="activeTeamId" v-model:open="createOpen" :team-id="activeTeamId" />
</template>
