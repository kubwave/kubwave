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
</script>

<template>
	<div class="flex flex-col gap-6">
		<DashboardGreeting />
		<DashboardOverview />
	</div>
</template>
