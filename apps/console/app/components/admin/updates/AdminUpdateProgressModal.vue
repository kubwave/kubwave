<script setup lang="ts">
import { CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-vue-next';
import { updateRunStatusLabel } from '~/utils/update-runs';

const props = withDefaults(
	defineProps<{
		runId: string | null;
		// Only freshly-triggered updates reload on success, not when viewing a historical run's logs.
		autoReloadOnSuccess?: boolean;
	}>(),
	{ autoReloadOnSuccess: false }
);

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ finished: [] }>();

const { run, finished, succeeded, isFailed, logs } = useUpdateRunProgress(() => props.runId, open);

// Fire finished once per terminal run; schedule the reload for fresh successes.
const notifiedRunId = ref<string | null>(null);
watch(
	[finished, () => props.runId],
	() => {
		if (!finished.value || !props.runId || notifiedRunId.value === props.runId) return;
		notifiedRunId.value = props.runId;
		emit('finished');
		if (succeeded.value && props.autoReloadOnSuccess) {
			setTimeout(() => window.location.reload(), 3000);
		}
	},
	{ immediate: true }
);

// Reset the per-run notification guard when the modal opens a different run.
watch(open, value => {
	if (!value) notifiedRunId.value = null;
});

const statusColor = computed(() => (succeeded.value ? 'text-success' : isFailed.value ? 'text-destructive' : 'text-info'));
const badgeVariant = computed(() => (isFailed.value ? 'destructive' : 'default'));
const barColor = computed(() => (succeeded.value ? 'bg-success' : isFailed.value ? 'bg-destructive' : 'bg-info'));

// The dialog is only dismissible once the run is terminal.
function handleUpdateOpen(next: boolean) {
	if (!next && !finished.value) return;
	open.value = next;
}

function preventWhileRunning(event: Event) {
	if (!finished.value) event.preventDefault();
}
</script>

<template>
	<Dialog :open="open" @update:open="handleUpdateOpen">
		<DialogContent
			class="sm:max-w-xl"
			:show-close-button="finished"
			@escape-key-down="preventWhileRunning"
			@pointer-down-outside="preventWhileRunning"
			@interact-outside="preventWhileRunning"
		>
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<CheckCircle2 v-if="succeeded" class="size-4" :class="statusColor" />
					<XCircle v-else-if="isFailed" class="size-4" :class="statusColor" />
					<Loader2 v-else class="size-4 animate-spin" :class="statusColor" />
					Platform update
				</DialogTitle>
			</DialogHeader>

			<div class="flex flex-col gap-4">
				<div v-if="run" class="flex items-center justify-between gap-2">
					<span class="font-mono text-sm">{{ run.fromVersion }} → {{ run.toVersion }}</span>
					<Badge :variant="badgeVariant">{{ updateRunStatusLabel(run) }}</Badge>
				</div>

				<!-- Progress bar: indeterminate while running, full when terminal. -->
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div v-if="finished" class="h-full w-full rounded-full transition-all" :class="barColor" />
					<div v-else class="update-progress-indeterminate h-full w-1/3 rounded-full" :class="barColor" />
				</div>

				<div v-if="!finished" class="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" />
					<span>Please wait — the console will be briefly unavailable during the update…</span>
				</div>

				<div v-if="run?.lastError" class="rounded-md bg-destructive/10 p-3">
					<p class="text-sm font-semibold text-destructive">Error:</p>
					<p class="mt-1 font-mono text-xs text-destructive">{{ run.lastError }}</p>
				</div>

				<div v-if="logs" class="overflow-hidden rounded-md border">
					<div class="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5">
						<Terminal class="size-3.5 text-muted-foreground" />
						<span class="text-xs font-medium text-muted-foreground">Logs</span>
					</div>
					<pre class="max-h-64 overflow-y-auto bg-background p-3 font-mono text-xs whitespace-pre-wrap">{{ logs }}</pre>
				</div>

				<p v-if="succeeded && autoReloadOnSuccess" class="text-sm text-success-foreground">Update complete. Page will reload automatically…</p>
			</div>

			<DialogFooter v-if="finished">
				<Button variant="outline" @click="open = false">Close</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
</template>

<style scoped>
@keyframes update-progress-indeterminate {
	0% {
		transform: translateX(-100%);
	}
	100% {
		transform: translateX(300%);
	}
}
.update-progress-indeterminate {
	animation: update-progress-indeterminate 1.4s ease-in-out infinite;
}
</style>
