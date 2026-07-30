<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { clusterSnapshotQuery, clusterUsageQuery } from '~/composables/use-admin-cluster';

definePageMeta({ middleware: 'admin' });
useHead({ title: 'Monitoring' });

const api = useApi();
const queryClient = useQueryClient();

// Prefetch key must match useClusterUsage's, or hydration re-fetches instead of reading this cache entry.
onServerPrefetch(() => Promise.all([queryClient.prefetchQuery(clusterSnapshotQuery(api)), queryClient.prefetchQuery(clusterUsageQuery(api, '1h'))]));

const { snapshot, isLoading } = useClusterSnapshot();
</script>

<template>
	<div class="flex flex-col gap-6">
		<PageHeader title="Monitoring" description="Cluster capacity, node health, and recent warnings." />
		<AdminClusterStatusStrip :snapshot="snapshot" :pending="isLoading" />
		<AdminClusterTabs :snapshot="snapshot" />
	</div>
</template>
