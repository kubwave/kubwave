<script setup lang="ts">
// Inline status pill (dot + label + optional replica readout); a styled span, not Badge,
// to preserve the ping animation.
export type RuntimeStatus = 'running' | 'degraded' | 'progressing' | 'stopped' | 'failed' | 'not_deployed' | 'unknown';

const STATUS: Record<RuntimeStatus, { label: string; dot: string; text: string; pulse?: boolean }> = {
	running: { label: 'Running', dot: 'bg-success', text: 'text-success-foreground' },
	degraded: { label: 'Degraded', dot: 'bg-warning', text: 'text-warning-foreground' },
	progressing: { label: 'Deploying', dot: 'bg-info', text: 'text-info', pulse: true },
	failed: { label: 'Failed', dot: 'bg-destructive', text: 'text-destructive' },
	stopped: { label: 'Stopped', dot: 'bg-zinc-400', text: 'text-muted-foreground' },
	not_deployed: { label: 'Not deployed', dot: 'bg-zinc-300 dark:bg-zinc-600', text: 'text-muted-foreground' },
	unknown: { label: 'Unknown', dot: 'bg-zinc-400', text: 'text-muted-foreground' }
};

const props = defineProps<{
	status: RuntimeStatus;
	readyReplicas?: number;
	desiredReplicas?: number;
	class?: string;
}>();

const meta = computed(() => STATUS[props.status] ?? STATUS.unknown);
const showReplicas = computed(
	() => (props.status === 'running' || props.status === 'degraded' || props.status === 'progressing') && props.desiredReplicas != null
);
</script>

<template>
	<span :class="['inline-flex items-center gap-1.5 text-xs font-medium', meta.text, $props.class]">
		<span class="relative flex size-2">
			<span v-if="meta.pulse" :class="['absolute inline-flex size-full animate-ping rounded-full opacity-60', meta.dot]" />
			<span :class="['relative inline-flex size-2 rounded-full', meta.dot]" />
		</span>
		{{ meta.label }}
		<span v-if="showReplicas" class="font-mono text-[0.7rem] tabular-nums text-muted-foreground">{{ readyReplicas ?? 0 }}/{{ desiredReplicas }}</span>
	</span>
</template>
