<script setup lang="ts">
import type { ClusterNodeDetail } from '~/utils/types';

const props = defineProps<{ detail: ClusterNodeDetail }>();

const podsText = computed(() => `${Math.round(props.detail.node.pods.used ?? 0)} / ${Math.round(props.detail.node.pods.capacity)} pods`);

const parts = computed(() => [props.detail.node.roles.join(', '), props.detail.node.kubeletVersion, podsText.value].filter(part => part.length > 0));
</script>

<template>
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
		<span :class="['size-2 shrink-0 rounded-full', detail.node.conditions.ready ? 'bg-success' : 'bg-destructive']" aria-hidden="true" />
		<span class="font-medium">{{ detail.node.conditions.ready ? 'Ready' : 'NotReady' }}</span>
		<span v-if="detail.node.cordoned" class="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Cordoned</span>
		<span class="text-muted-foreground">· {{ parts.join(' · ') }}</span>
	</div>
</template>
