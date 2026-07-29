<script setup lang="ts">
import { AlertTriangle, Boxes, CheckCircle2 } from 'lucide-vue-next';
import type { ClusterComponent } from '~/utils/types';

const props = defineProps<{ components: ClusterComponent[] }>();

const rows = computed(() => props.components.map(component => ({ ...component, healthy: component.ready >= component.desired })));
</script>

<template>
	<EmptyState
		v-if="rows.length === 0"
		:icon="Boxes"
		title="No platform components found"
		description="Nothing in the platform namespace carried the kubwave labels for this snapshot."
	/>

	<div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		<div v-for="row in rows" :key="row.name" class="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
			<div class="min-w-0">
				<p class="truncate font-medium">{{ row.name }}</p>
				<p class="mt-0.5 text-xs text-muted-foreground tabular-nums">{{ row.ready }} / {{ row.desired }} ready</p>
			</div>
			<CheckCircle2 v-if="row.healthy" class="size-5 shrink-0 text-success" />
			<AlertTriangle v-else class="size-5 shrink-0 text-warning" />
		</div>
	</div>
</template>
