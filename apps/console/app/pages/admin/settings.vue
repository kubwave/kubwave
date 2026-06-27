<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { platformHealthQuery, updateRunsQuery, versionInfoQuery } from '~/composables/use-admin-system';

// SSR-prefetches version + updates + health (keys AdminSystemStatus reads), then renders the settings tabs. Admin-gated.
definePageMeta({ middleware: 'admin' });
useHead({ title: 'Settings' });

const api = useApi();
const queryClient = useQueryClient();

onServerPrefetch(() =>
	Promise.all([
		queryClient.prefetchQuery(versionInfoQuery(api)),
		queryClient.prefetchQuery(updateRunsQuery(api)),
		queryClient.prefetchQuery(platformHealthQuery(api))
	])
);
</script>

<template>
	<div class="flex flex-col gap-6">
		<PageHeader title="Settings" description="Platform health, scaling, and integrations." />
		<AdminSettingsTabs />
	</div>
</template>
