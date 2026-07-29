<script setup lang="ts">
import { Server } from 'lucide-vue-next';
import { formatBytes } from '~/utils/format';
import { formatCpu } from '~/utils/metrics-format';
import type { ClusterNode } from '~/utils/types';

const props = defineProps<{ nodes: ClusterNode[] }>();

interface NodeBadge {
	label: string;
	tone: string;
}

const SUCCESS = 'border-success/25 bg-success/10 text-success-foreground';
const WARNING = 'border-warning/25 bg-warning/10 text-warning-foreground';
const DANGER = 'border-destructive/25 bg-destructive/10 text-destructive';
const NEUTRAL = 'border-border bg-muted text-muted-foreground';

function badgesFor(node: ClusterNode): NodeBadge[] {
	const badges: NodeBadge[] = [node.conditions.ready ? { label: 'Ready', tone: SUCCESS } : { label: 'NotReady', tone: DANGER }];
	if (node.cordoned) badges.push({ label: 'Cordoned', tone: NEUTRAL });
	if (node.conditions.memoryPressure) badges.push({ label: 'MemoryPressure', tone: WARNING });
	if (node.conditions.diskPressure) badges.push({ label: 'DiskPressure', tone: WARNING });
	if (node.conditions.pidPressure) badges.push({ label: 'PIDPressure', tone: WARNING });
	return badges;
}

const rows = computed(() => props.nodes.map(node => ({ node, badges: badgesFor(node) })));

function podsText(node: ClusterNode): string {
	return `${Math.round(node.pods.used ?? 0)} / ${Math.round(node.pods.capacity)}`;
}
</script>

<template>
	<EmptyState v-if="nodes.length === 0" :icon="Server" title="No nodes" description="The cluster reported no nodes for this snapshot." />

	<div v-else class="overflow-hidden rounded-xl border bg-card shadow-xs">
		<div class="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead class="text-xs">Node</TableHead>
						<TableHead class="text-xs">Status</TableHead>
						<TableHead class="text-xs">Kubelet</TableHead>
						<TableHead class="min-w-32 text-xs">CPU</TableHead>
						<TableHead class="min-w-32 text-xs">Memory</TableHead>
						<TableHead class="min-w-32 text-xs">Disk</TableHead>
						<TableHead class="text-xs">Pods</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow v-for="row in rows" :key="row.node.name">
						<TableCell class="py-3">
							<p class="font-medium">{{ row.node.name }}</p>
							<p v-if="row.node.roles.length > 0" class="mt-0.5 text-xs text-muted-foreground">{{ row.node.roles.join(', ') }}</p>
						</TableCell>
						<TableCell class="py-3">
							<div class="flex flex-wrap gap-1">
								<span
									v-for="badge in row.badges"
									:key="badge.label"
									:class="['rounded-full border px-2 py-0.5 text-[0.7rem] font-medium', badge.tone]"
								>
									{{ badge.label }}
								</span>
							</div>
						</TableCell>
						<TableCell class="py-3 font-mono text-xs text-muted-foreground">{{ row.node.kubeletVersion || '—' }}</TableCell>
						<TableCell class="py-3"><AdminClusterResourceMeter :meter="row.node.cpu" :format="formatCpu" compact /></TableCell>
						<TableCell class="py-3"><AdminClusterResourceMeter :meter="row.node.memory" :format="formatBytes" compact /></TableCell>
						<TableCell class="py-3"><AdminClusterResourceMeter :meter="row.node.disk" :format="formatBytes" compact /></TableCell>
						<TableCell class="py-3 text-sm tabular-nums">{{ podsText(row.node) }}</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
	</div>
</template>
