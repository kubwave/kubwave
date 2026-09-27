<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next';

const { events, isLoading } = useClusterEvents();
</script>

<template>
	<div v-if="isLoading && !events" class="flex items-center gap-2 py-10 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Loading events…
	</div>

	<p
		v-else-if="events?.available === false"
		role="alert"
		class="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive"
	>
		Could not read events from the cluster.
	</p>

	<AdminClusterEventList v-else :events="events?.events ?? []" />
</template>
