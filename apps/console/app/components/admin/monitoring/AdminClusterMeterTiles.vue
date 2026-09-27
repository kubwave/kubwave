<script setup lang="ts">
import { Boxes, Cpu, HardDrive, MemoryStick } from 'lucide-vue-next';
import { formatBytes } from '~/utils/format';
import { formatCpu } from '~/utils/metrics-format';
import type { ClusterMeter } from '~/utils/types';

const props = defineProps<{ cpu: ClusterMeter; memory: ClusterMeter; disk: ClusterMeter; diskLabel: string; pods: ClusterMeter }>();

const tiles = computed(() => [
	{ key: 'cpu', label: 'CPU', icon: Cpu, meter: props.cpu, format: formatCpu },
	{ key: 'memory', label: 'Memory', icon: MemoryStick, meter: props.memory, format: formatBytes },
	{ key: 'disk', label: props.diskLabel, icon: HardDrive, meter: props.disk, format: formatBytes },
	{ key: 'pods', label: 'Pods', icon: Boxes, meter: props.pods, format: (value: number) => String(Math.round(value)) }
]);
</script>

<template>
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div v-for="tile in tiles" :key="tile.key" class="rounded-lg border bg-card p-3">
			<div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
				<component :is="tile.icon" class="size-3.5 shrink-0" />
				{{ tile.label }}
			</div>
			<AdminClusterResourceMeter class="mt-2" :meter="tile.meter" :format="tile.format" />
		</div>
	</div>
</template>
