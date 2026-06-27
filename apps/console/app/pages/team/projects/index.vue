<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { teamProjectsQuery } from '~/composables/use-project-data';
import { teamsQuery } from '~/composables/use-team-data';

const api = useApi();
const queryClient = useQueryClient();

onServerPrefetch(async () => {
	const teamsData = await queryClient.fetchQuery(teamsQuery(api));
	const teamId = teamsData?.activeTeamId ?? teamsData?.teams?.[0]?.id ?? null;
	if (teamId) await queryClient.prefetchQuery(teamProjectsQuery(api, teamId));
});

const { activeTeam, activeTeamId } = useTeamContext();
const teamName = computed(() => activeTeam.value?.name);
</script>

<template>
	<div class="flex flex-col gap-6">
		<PageHeader title="Projects">
			<template #description>
				Applications and environments in <span class="font-medium text-foreground">{{ teamName ?? 'your team' }}</span
				>.
			</template>
			<template #actions>
				<ProjectsCreateButton :active-team-id="activeTeamId" />
			</template>
		</PageHeader>
		<ProjectsGrid :active-team-id="activeTeamId" />
	</div>
</template>
