<script setup lang="ts">
import { Boxes, Gauge, Server, TriangleAlert } from 'lucide-vue-next';
import type { ClusterSnapshot } from '~/utils/types';

const props = defineProps<{ snapshot: ClusterSnapshot | undefined }>();

const tab = ref('utilization');

const nodeCount = computed(() => props.snapshot?.nodes.length ?? 0);
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
					<span v-if="nodeCount > 0" class="ml-1 text-xs text-muted-foreground tabular-nums">{{ nodeCount }}</span>
				</TabsTrigger>
				<TabsTrigger value="components">
					<Boxes class="size-4" />
					Components
				</TabsTrigger>
				<TabsTrigger value="events">
					<TriangleAlert class="size-4" />
					Events
				</TabsTrigger>
			</TabsList>
		</Tabs>

		<AdminClusterUtilization v-if="tab === 'utilization'" :snapshot="snapshot" :active="tab === 'utilization'" />
		<AdminClusterNodesTable v-else-if="tab === 'nodes'" :nodes="snapshot?.nodes ?? []" />
		<AdminClusterComponents v-else-if="tab === 'components'" :components="snapshot?.components ?? []" />
		<AdminClusterEvents v-else-if="tab === 'events'" :active="tab === 'events'" />
	</div>
</template>
