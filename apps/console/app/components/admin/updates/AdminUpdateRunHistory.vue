<script setup lang="ts">
import { FileText, History } from 'lucide-vue-next';
import type { PlatformUpdatesListResponse } from '@kubwave/api-client';
import { updateRunDateLabel, updateRunStatusMeta } from '~/utils/update-runs';

type UpdateRun = PlatformUpdatesListResponse[number];

defineProps<{ updateRuns: UpdateRun[] }>();
const emit = defineEmits<{ viewLogs: [runId: string] }>();
</script>

<template>
	<div class="flex h-96 flex-col rounded-xl border bg-card shadow-xs">
		<div class="px-6 py-4">
			<p class="text-base font-semibold">Update history</p>
		</div>

		<div v-if="updateRuns.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
			<History class="size-8 text-muted-foreground" />
			<p class="text-sm text-muted-foreground">No updates performed yet.</p>
		</div>

		<div v-else class="min-h-0 flex-1 overflow-y-auto">
			<ul class="px-4 py-4 sm:px-6">
				<li v-for="(run, index) in updateRuns" :key="run.id" class="relative flex gap-3 pb-5 last:pb-0">
					<span v-if="index !== updateRuns.length - 1" aria-hidden class="absolute top-7 left-3 -ml-px h-[calc(100%-1rem)] w-px bg-border" />
					<span
						class="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
						:class="updateRunStatusMeta(run.status).dot"
					>
						<component :is="updateRunStatusMeta(run.status).icon" class="size-3.5" :class="updateRunStatusMeta(run.status).spin && 'animate-spin'" />
					</span>

					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-mono text-sm">{{ run.fromVersion }} → {{ run.toVersion }}</span>
							<Badge :variant="updateRunStatusMeta(run.status).variant">{{ updateRunStatusMeta(run.status).label }}</Badge>
						</div>
						<p class="mt-0.5 text-xs text-muted-foreground">{{ updateRunDateLabel(run) }}</p>
						<p v-if="run.lastError" class="mt-1 truncate text-xs text-destructive" :title="run.lastError">{{ run.lastError }}</p>
					</div>

					<Button variant="ghost" size="sm" class="-mt-1 shrink-0 gap-1.5 text-muted-foreground" @click="emit('viewLogs', run.id)">
						<FileText />
						Logs
					</Button>
				</li>
			</ul>
		</div>
	</div>
</template>
