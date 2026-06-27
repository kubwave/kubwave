<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { environmentServicesQuery, projectQuery } from '~/composables/use-project-data';

const route = useRoute();
const projectId = route.params.projectId as string;

const api = useApi();
const queryClient = useQueryClient();

onServerPrefetch(async () => {
	const project = await queryClient.fetchQuery(projectQuery(api, projectId)).catch(() => null);

	const initialEnvId = project?.environments[0]?.id ?? null;
	if (initialEnvId) {
		await queryClient.prefetchQuery(environmentServicesQuery(api, initialEnvId));
	}
});

// Live project (seeded from the prefetched cache) so header edits reflect.
const { data: project } = useProjectDetail(projectId, { retry: false });

const initialEnvId = computed(() => project.value?.environments[0]?.id ?? null);

// Seed the per-project selected env once; useState is keyed by projectId so each project gets isolated state.
useSelectedEnv(projectId, initialEnvId.value);

useHead({ title: computed(() => project.value?.name ?? 'Project') });
</script>

<template>
	<div v-if="!project" class="rounded-xl border px-4 py-16 text-center">
		<p class="text-sm text-muted-foreground">This project is no longer available.</p>
		<Button as-child variant="outline" size="sm" class="mt-4">
			<NuxtLink to="/team/projects">Back to projects</NuxtLink>
		</Button>
	</div>

	<div v-else class="flex h-[calc(100dvh-7.5rem)] flex-col md:h-[calc(100dvh-4rem)]">
		<PageHeader :title="project.name" :description="project.description ?? undefined">
			<template #breadcrumb>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink as-child>
								<NuxtLink to="/team/projects">Projects</NuxtLink>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage class="truncate">{{ project.name }}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</template>
			<template #actions>
				<ProjectSettingsButton :project="project" />
			</template>
		</PageHeader>

		<ProjectEnvironmentBar :project="project" />

		<div class="mt-4 min-h-0 flex-1">
			<ProjectCanvas :project-id="project.id" :team-id="project.teamId" />
		</div>
	</div>
</template>
