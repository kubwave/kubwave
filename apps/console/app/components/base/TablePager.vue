<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

// Compact prev/next pager for client-paginated tables. Self-hides when there's only one page
// (pageCount > 1 ⟺ items > pageSize), so callers no longer guard it themselves.
defineProps<{ pageCount: number }>();
const page = defineModel<number>('page', { required: true });
</script>

<template>
	<div v-if="pageCount > 1" class="flex items-center justify-end gap-2">
		<Button variant="outline" size="icon" class="size-8" :disabled="page <= 1" aria-label="Previous page" @click="page--">
			<ChevronLeft />
		</Button>
		<span class="text-sm text-muted-foreground tabular-nums">Page {{ page }} of {{ pageCount }}</span>
		<Button variant="outline" size="icon" class="size-8" :disabled="page >= pageCount" aria-label="Next page" @click="page++">
			<ChevronRight />
		</Button>
	</div>
</template>
