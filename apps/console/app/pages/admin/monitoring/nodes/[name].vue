<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { clusterNodeQuery, clusterNodeUsageQuery } from '~/composables/use-admin-cluster';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const name = route.params.name as string;

const api = useApi();
const queryClient = useQueryClient();

// Prefetch key must match useClusterNodeUsage's, or hydration re-fetches instead of reading this cache entry.
onServerPrefetch(() =>
	Promise.all([queryClient.prefetchQuery(clusterNodeQuery(api, name)), queryClient.prefetchQuery(clusterNodeUsageQuery(api, name, '1h'))])
);

const { node: detail, isLoading } = useClusterNode(name);

const unavailableMessage = computed(() => {
	if (!detail.value) return 'This page failed to load. It keeps retrying automatically.';
	return detail.value.unavailableReason === 'not-found'
		? 'This node is no longer part of the cluster.'
		: 'The cluster could not be reached. This page keeps retrying automatically, and the node may still be here.';
});

useHead({ title: computed(() => `${name} · Monitoring`) });
</script>

<template>
	<div v-if="!isLoading && (!detail || detail.available === false)" class="rounded-xl border px-4 py-16 text-center">
		<p class="text-sm text-muted-foreground">{{ unavailableMessage }}</p>
		<Button as-child variant="outline" size="sm" class="mt-4">
			<NuxtLink to="/admin/monitoring">Back to monitoring</NuxtLink>
		</Button>
	</div>

	<div v-else class="flex flex-col gap-6">
		<PageHeader :title="name">
			<template #breadcrumb>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink as-child>
								<NuxtLink to="/admin/monitoring">Monitoring</NuxtLink>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage class="truncate">{{ name }}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</template>
		</PageHeader>

		<AdminNodeHeader v-if="detail" :detail="detail" />

		<AdminNodeCharts :name="name" />

		<AdminNodeConditions v-if="detail" :conditions="detail.conditions" :taints="detail.taints" />

		<section v-if="detail" class="flex flex-col gap-3">
			<h2 class="text-sm font-medium">Pods on this node</h2>
			<AdminNodePods :pods="detail.pods" />
		</section>

		<section v-if="detail" class="flex flex-col gap-3">
			<h2 class="text-sm font-medium">Warning events for this node</h2>
			<AdminNodeEvents :events="detail.events" />
		</section>
	</div>
</template>
