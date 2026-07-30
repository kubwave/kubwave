<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next';
import { formatRelative } from '~/utils/format';
import type { ClusterEvent } from '~/utils/types';

defineProps<{ events: ClusterEvent[] }>();
</script>

<template>
	<div class="flex flex-col gap-3">
		<EmptyState
			v-if="events.length === 0"
			:icon="CheckCircle2"
			title="No warnings"
			description="This node reported no warning events in the window Kubernetes still retains."
		/>

		<div v-else class="overflow-hidden rounded-xl border bg-card shadow-xs">
			<div
				v-for="event in events"
				:key="event.id"
				class="flex flex-col gap-1 border-b p-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
			>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<span class="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[0.7rem] font-medium text-warning-foreground">
							{{ event.reason || 'Warning' }}
						</span>
						<span v-if="event.count > 1" class="text-xs text-muted-subtle tabular-nums">×{{ event.count }}</span>
					</div>
					<p class="mt-1.5 text-sm">{{ event.message }}</p>
				</div>
				<p class="shrink-0 text-xs text-muted-foreground">{{ formatRelative(event.lastSeen, '—') }}</p>
			</div>
		</div>

		<p class="text-xs text-muted-subtle">Kubernetes prunes events after about an hour, so this list covers roughly the last hour.</p>
	</div>
</template>
