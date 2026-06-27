<script setup lang="ts">
import { Copy, Download, Loader2, Pause, Play } from 'lucide-vue-next';
import type { Service, ServiceLogEntry } from '~/utils/types';

const props = defineProps<{ service: Service; active: boolean }>();

const toast = useToast();

// Compact pod name (svc-<uuid>-<rs>-<id>) to its trailing identifier; the prefix is constant per service.
function shortPod(name: string): string {
	const parts = name.split('-');
	return parts.slice(-2).join('-') || name;
}

function formatTime(ts: string | null): string {
	if (!ts) return '';
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString(undefined, { hour12: false });
}

function toText(items: ServiceLogEntry[], showPod: boolean): string {
	return items.map(e => `${e.timestamp ?? ''}${showPod ? ` [${shortPod(e.pod)}]` : ''} ${e.message}`.trim()).join('\n');
}

const pod = ref<string | 'all'>('all');
const follow = ref(true);

const serviceId = computed(() => props.service.id);
const { entries, pods, available, isLoading } = useServiceLogs(serviceId, () => props.active, follow, pod);

const showPodColumn = computed(() => pod.value === 'all' && pods.value.length > 1);

// Pod selector items: "All pods (n)" + one entry per pod (short label, full value).
const podItems = computed(() => [
	{ label: `All pods (${pods.value.length})`, value: 'all' },
	...pods.value.map(p => ({ label: shortPod(p), value: p }))
]);

// Stick to the bottom while following, unless the user has scrolled up to read history.
const scrollerRef = ref<HTMLElement | null>(null);
// Non-reactive: never rendered, so a plain closure variable.
let stick = true;

function onScroll() {
	const el = scrollerRef.value;
	if (!el) return;
	stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

// flush: 'post' runs after the DOM patch, so we measure/scroll against the freshly-rendered lines.
watch(
	entries,
	() => {
		const el = scrollerRef.value;
		if (el && stick) el.scrollTop = el.scrollHeight;
	},
	{ flush: 'post' }
);

async function onCopy() {
	// navigator.clipboard is undefined outside a secure context (e.g. a console served over plain HTTP).
	if (!navigator.clipboard) {
		toast.error('Clipboard unavailable', 'Copying needs a secure (HTTPS) context.');
		return;
	}
	try {
		await navigator.clipboard.writeText(toText(entries.value, showPodColumn.value));
		toast.success('Logs copied');
	} catch {
		toast.error('Could not copy logs');
	}
}

function onDownload() {
	const blob = new Blob([toText(entries.value, showPodColumn.value)], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${props.service.name}-logs.txt`;
	a.click();
	URL.revokeObjectURL(url);
}
</script>

<template>
	<div class="flex h-full min-h-0 flex-col gap-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<Select v-if="pods.length > 1" v-model="pod">
					<SelectTrigger size="sm" class="w-44 font-mono text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem v-for="item in podItems" :key="item.value" :value="item.value" class="font-mono text-xs">{{ item.label }}</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div class="flex items-center gap-1.5">
				<Button type="button" variant="outline" size="sm" @click="follow = !follow">
					<Pause v-if="follow" />
					<Play v-else />
					{{ follow ? 'Pause' : 'Follow' }}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-8 text-muted-foreground"
					:disabled="entries.length === 0"
					title="Copy logs"
					@click="onCopy"
				>
					<Copy />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-8 text-muted-foreground"
					:disabled="entries.length === 0"
					title="Download logs"
					@click="onDownload"
				>
					<Download />
				</Button>
			</div>
		</div>

		<div v-if="isLoading && entries.length === 0" class="flex items-center gap-2 py-10 text-sm text-muted-foreground">
			<Loader2 class="size-4 animate-spin" />
			Loading logs…
		</div>
		<div v-else-if="!available && entries.length === 0" class="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
			No logs yet. Deploy and run this service to see its output here.
		</div>
		<div v-else-if="entries.length === 0" class="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
			This service is running but hasn’t produced any log output.
		</div>
		<div
			v-else
			ref="scrollerRef"
			class="min-h-0 flex-1 overflow-y-auto rounded-xl bg-muted/50 p-3 font-mono text-xs leading-relaxed ring ring-border"
			@scroll="onScroll"
		>
			<div v-for="(e, i) in entries" :key="`${e.pod}-${e.timestamp ?? ''}-${i}`" class="flex gap-2 break-all whitespace-pre-wrap">
				<span class="shrink-0 tabular-nums text-muted-foreground/60 select-none">{{ formatTime(e.timestamp) }}</span>
				<span v-if="showPodColumn" class="shrink-0 text-muted-foreground/50 select-none">{{ shortPod(e.pod) }}</span>
				<span :class="e.message ? 'text-foreground/90' : 'text-muted-foreground'">{{ e.message || ' ' }}</span>
			</div>
		</div>
	</div>
</template>
