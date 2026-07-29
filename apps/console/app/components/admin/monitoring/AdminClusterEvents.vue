<script setup lang="ts">
import { CheckCircle2, Loader2 } from 'lucide-vue-next';
import { formatRelative } from '~/utils/format';

const props = defineProps<{ active: boolean }>();

const { events, isLoading } = useClusterEvents(() => props.active);

const rows = computed(() => events.value?.events ?? []);
const unreachable = computed(() => events.value?.available === false);
</script>

<template>
	<div class="flex flex-col gap-3">
		<div v-if="isLoading && !events" class="flex items-center gap-2 py-10 text-sm text-muted-foreground">
			<Loader2 class="size-4 animate-spin" />
			Loading events…
		</div>

		<p v-else-if="unreachable" role="alert" class="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive">
			Could not read events from the cluster.
		</p>

		<EmptyState
			v-else-if="rows.length === 0"
			:icon="CheckCircle2"
			title="No warnings"
			description="No warning events in the window Kubernetes still retains."
		/>

		<div v-else class="overflow-hidden rounded-xl border bg-card shadow-xs">
			<div
				v-for="event in rows"
				:key="event.id"
				class="flex flex-col gap-1 border-b p-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
			>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<span class="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[0.7rem] font-medium text-warning-foreground">
							{{ event.reason || 'Warning' }}
						</span>
						<span v-if="event.count > 1" class="text-xs text-muted-subtle tabular-nums">×{{ event.count }}</span>
						<span v-if="event.objectKind && event.objectName" class="truncate font-mono text-xs text-muted-foreground">
							{{ event.objectKind }}/{{ event.objectName }}
						</span>
					</div>
					<p class="mt-1.5 text-sm">{{ event.message }}</p>
					<p v-if="event.namespace" class="mt-1 font-mono text-xs text-muted-subtle">{{ event.namespace }}</p>
				</div>
				<p class="shrink-0 text-xs text-muted-foreground">{{ formatRelative(event.lastSeen, '—') }}</p>
			</div>
		</div>

		<p class="text-xs text-muted-subtle">Kubernetes prunes events after about an hour, so this list covers roughly the last hour.</p>
	</div>
</template>
