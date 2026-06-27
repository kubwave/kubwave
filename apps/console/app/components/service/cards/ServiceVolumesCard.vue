<script setup lang="ts">
import { HardDrive } from 'lucide-vue-next';
import { formatBytes, percentOf } from '~/utils/format';
import type { ServiceMetrics } from '~/utils/types';

defineProps<{ volumes: ServiceMetrics['current']['volumes'] }>();
</script>

<template>
	<div class="rounded-xl bg-muted/30 px-4 py-3">
		<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<HardDrive class="size-3.5 text-amber-500" />
			Persistent volumes
		</span>
		<p v-if="volumes.length === 0" class="mt-2 text-sm text-muted-foreground">No persistent volumes.</p>
		<div v-else class="mt-2 flex flex-col gap-2.5">
			<div v-for="vol in volumes" :key="vol.name">
				<div class="flex items-center justify-between text-xs">
					<span class="font-mono text-foreground/80">{{ vol.name }}</span>
					<span class="tabular-nums text-muted-foreground">{{ formatBytes(vol.usedBytes) }} / {{ formatBytes(vol.capacityBytes) }}</span>
				</div>
				<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
					<div class="h-full rounded-full bg-amber-500" :style="{ width: `${percentOf(vol.usedBytes, vol.capacityBytes) ?? 0}%` }" />
				</div>
			</div>
		</div>
	</div>
</template>
