<script setup lang="ts">
import { Boxes } from 'lucide-vue-next';
import { formatBytes } from '~/utils/format';
import { formatCpu } from '~/utils/metrics-format';
import type { ClusterNodePod } from '~/utils/types';

defineProps<{ pods: ClusterNodePod[] }>();
</script>

<template>
	<EmptyState v-if="pods.length === 0" :icon="Boxes" title="No pods" description="Nothing is scheduled to this node right now." />

	<div v-else class="overflow-hidden rounded-xl border bg-card shadow-xs">
		<div class="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead class="text-xs">Namespace</TableHead>
						<TableHead class="text-xs">Pod</TableHead>
						<TableHead class="text-xs">Phase</TableHead>
						<TableHead class="text-xs">CPU</TableHead>
						<TableHead class="text-xs">Memory</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow v-for="pod in pods" :key="`${pod.namespace}/${pod.name}`">
						<TableCell class="py-3 font-mono text-xs text-muted-foreground">{{ pod.namespace }}</TableCell>
						<TableCell class="py-3 font-mono text-xs">{{ pod.name }}</TableCell>
						<TableCell class="py-3 text-sm">{{ pod.phase }}</TableCell>
						<TableCell class="py-3 text-sm tabular-nums">{{ pod.cpuMillicores == null ? '—' : formatCpu(pod.cpuMillicores) }}</TableCell>
						<TableCell class="py-3 text-sm tabular-nums">{{ pod.memoryBytes == null ? '—' : formatBytes(pod.memoryBytes) }}</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
	</div>
</template>
