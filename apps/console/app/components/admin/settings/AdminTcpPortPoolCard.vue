<script setup lang="ts">
import { Loader2, Network, ShieldAlert } from 'lucide-vue-next';

const { settings, save } = useTcpPortPoolSettings();
const draft = reactive({ enabled: true, start: 30100, size: 20 });
const updateRunId = ref<string | null>(null);
const progressOpen = ref(false);
const retryAvailable = ref(false);

watch(
	settings,
	value => {
		if (!value || save.isPending.value) return;
		draft.enabled = value.enabled;
		draft.start = value.start;
		draft.size = value.size;
	},
	{ immediate: true }
);

const valid = computed(() => {
	return (
		Number.isInteger(draft.start) &&
		draft.start >= 1024 &&
		draft.start <= 65535 &&
		Number.isInteger(draft.size) &&
		draft.size >= 1 &&
		draft.size <= 100 &&
		draft.start + draft.size - 1 <= 65535
	);
});
const dirty = computed(() => {
	const original = settings.value;
	if (!original) return false;
	return draft.enabled !== original.enabled || draft.start !== original.start || draft.size !== original.size;
});

async function submit(): Promise<void> {
	if (!valid.value || (!dirty.value && !retryAvailable.value)) return;
	const updated = await save.mutateAsync({ enabled: draft.enabled, start: draft.start, size: draft.size });
	retryAvailable.value = false;
	updateRunId.value = updated.updateRun.id;
	progressOpen.value = true;
}
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Network class="size-4 text-muted-foreground" />
				Public TCP port pool
			</CardTitle>
			<CardDescription>Allocate raw TCP ports for explicitly exposed services, such as database migration endpoints.</CardDescription>
		</CardHeader>
		<CardContent>
			<form class="flex flex-col gap-5" @submit.prevent="submit">
				<div class="flex items-start justify-between gap-4">
					<div class="flex flex-col gap-0.5">
						<span class="text-sm font-medium">Enable public TCP ports</span>
						<span class="text-xs text-muted-foreground"
							>Disabled pools reject new service exposures and remove all Traefik TCP listeners after the update completes.</span
						>
					</div>
					<Switch v-model="draft.enabled" :disabled="save.isPending.value" aria-label="Enable public TCP port pool" />
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<label for="tcp-port-pool-start" class="text-sm font-medium">First public port</label>
						<Input id="tcp-port-pool-start" v-model.number="draft.start" type="number" :min="1024" :max="65535" :disabled="save.isPending.value" />
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="tcp-port-pool-size" class="text-sm font-medium">Pool size</label>
						<Input id="tcp-port-pool-size" v-model.number="draft.size" type="number" :min="1" :max="100" :disabled="save.isPending.value" />
					</div>
				</div>

				<p v-if="!valid" class="text-xs text-destructive">
					Use ports from 1024 to 65535, a size from 1 to 100, and keep the end port at or below 65535.
				</p>
				<p class="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
					<ShieldAlert class="mt-0.5 size-4 shrink-0" />
					Changes are blocked while an existing service exposure would fall outside the new pool. Public TCP ports are reachable from the internet.
				</p>

				<div class="flex justify-end">
					<Button type="submit" :disabled="(!dirty && !retryAvailable) || !valid || save.isPending.value">
						<Loader2 v-if="save.isPending.value" class="size-4 animate-spin" />
						{{ retryAvailable ? 'Retry network settings' : 'Apply network settings' }}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>

	<AdminUpdateProgressModal v-model:open="progressOpen" :run-id="updateRunId" @failed="retryAvailable = true" />
</template>
