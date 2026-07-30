<script setup lang="ts">
import { formatRelative } from '~/utils/format';
import type { ClusterNodeCondition } from '~/utils/types';

const props = defineProps<{ conditions: ClusterNodeCondition[]; taints: string[] }>();

// Ready is the one condition where True is good; every other node condition reports a problem when True.
function isHealthy(condition: ClusterNodeCondition): boolean {
	return condition.type === 'Ready' ? condition.status === 'True' : condition.status !== 'True';
}

const rows = computed(() => props.conditions.map(condition => ({ condition, healthy: isHealthy(condition) })));
</script>

<template>
	<div class="rounded-xl border bg-card p-4 shadow-xs">
		<p class="text-sm font-medium">Conditions</p>
		<div class="mt-3 flex flex-col gap-2">
			<div v-for="row in rows" :key="row.condition.type" class="flex items-baseline justify-between gap-3 text-xs">
				<span class="font-medium">{{ row.condition.type }}</span>
				<span class="flex items-baseline gap-2">
					<span :class="row.healthy ? 'text-muted-foreground' : 'text-warning-foreground'">{{ row.condition.reason ?? row.condition.status }}</span>
					<span class="text-muted-subtle tabular-nums">{{ formatRelative(row.condition.lastTransitionTime, '—') }}</span>
				</span>
			</div>
		</div>
		<p class="mt-3 border-t pt-3 text-xs text-muted-foreground">
			Taints: <span v-if="taints.length === 0">—</span>
			<span v-else class="font-mono">{{ taints.join(', ') }}</span>
		</p>
	</div>
</template>
