<script setup lang="ts">
import { Boxes, Gauge, Server, TriangleAlert } from 'lucide-vue-next';
import type { ClusterSnapshot } from '~/utils/types';

const props = defineProps<{ snapshot: ClusterSnapshot | undefined }>();

const TABS = ['utilization', 'nodes', 'components', 'events'] as const;
type Tab = (typeof TABS)[number];

// Kept in the query so a reload or the node page's way back lands on the same tab.
const route = useRoute();
const router = useRouter();
const tab = computed<Tab>({
	get: () => TABS.find(value => value === route.query.tab) ?? 'utilization',
	set: value => router.replace({ query: { ...route.query, tab: value === 'utilization' ? undefined : value } })
});

const { liveSeries } = useClusterLiveSamples(() => props.snapshot);

const nodeCount = computed(() => props.snapshot?.nodes.length ?? 0);
const unhealthyComponents = computed(() => props.snapshot?.components.filter(component => component.ready < component.desired).length ?? 0);
</script>

<template>
	<div class="flex flex-col gap-6">
		<Tabs v-model="tab" class="w-full">
			<TabsList>
				<TabsTrigger value="utilization">
					<Gauge class="size-4" />
					Utilization
				</TabsTrigger>
				<TabsTrigger value="nodes">
					<Server class="size-4" />
					Nodes
					<Badge v-if="nodeCount > 0" variant="secondary" class="tabular-nums">{{ nodeCount }}</Badge>
				</TabsTrigger>
				<TabsTrigger value="components">
					<Boxes class="size-4" />
					Components
					<Badge v-if="unhealthyComponents > 0" variant="destructive" class="tabular-nums">{{ unhealthyComponents }}</Badge>
				</TabsTrigger>
				<TabsTrigger value="events">
					<TriangleAlert class="size-4" />
					Events
				</TabsTrigger>
			</TabsList>
		</Tabs>

		<AdminClusterUtilization v-if="tab === 'utilization'" :snapshot="snapshot" :live-series="liveSeries" />
		<AdminClusterNodesTable v-else-if="tab === 'nodes'" :nodes="snapshot?.nodes ?? []" />
		<AdminClusterComponents v-else-if="tab === 'components'" :components="snapshot?.components ?? []" />
		<AdminClusterEvents v-else-if="tab === 'events'" />
	</div>
</template>
