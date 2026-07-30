<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { clusterNodeQuery } from '~/composables/use-admin-cluster';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const name = route.params.name as string;

const api = useApi();
const queryClient = useQueryClient();

onServerPrefetch(() => queryClient.prefetchQuery(clusterNodeQuery(api, name)));

const { node: detail, isLoading } = useClusterNode(name);

useHead({ title: computed(() => `${name} · Monitoring`) });
</script>

<template>
	<div v-if="!isLoading && detail?.available === false" class="rounded-xl border px-4 py-16 text-center">
		<p class="text-sm text-muted-foreground">This node is no longer part of the cluster.</p>
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
	</div>
</template>
