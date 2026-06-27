<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { teamMembersQuery, teamsQuery } from '~/composables/use-team-data';
import { teamSshKeysQuery } from '~/composables/use-team-ssh-keys';

const api = useApi();
const queryClient = useQueryClient();
const route = useRoute();

useHead({ title: 'Team settings' });

const initialTab = route.query.tab === 'members' ? 'members' : route.query.tab === 'ssh-keys' ? 'ssh-keys' : 'general';

onServerPrefetch(async () => {
	const teamsData = await queryClient.fetchQuery(teamsQuery(api));

	const activeTeamId = teamsData?.activeTeamId ?? teamsData?.teams?.[0]?.id ?? null;
	if (activeTeamId) {
		await Promise.all([
			queryClient.prefetchQuery(teamMembersQuery(api, activeTeamId)),
			initialTab === 'ssh-keys' ? queryClient.prefetchQuery(teamSshKeysQuery(api, activeTeamId)) : Promise.resolve()
		]);
	}
});
</script>

<template>
	<div>
		<TeamSettingsLayout :initial-tab="initialTab" />
	</div>
</template>
