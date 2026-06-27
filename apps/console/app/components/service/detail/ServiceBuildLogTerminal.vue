<script setup lang="ts">
import { Check, ChevronDown, Copy, Download } from 'lucide-vue-next';
import { buildLogLines } from '~/utils/build-log';
import type { Deployment, DeploymentBuildLogContainer } from '~/utils/types';

// Inline build log: a light-gray live tail while building, expanding to the full dark terminal (merged streams, ANSI, phase dividers).
const props = defineProps<{
	containers: DeploymentBuildLogContainer[];
	deployment: Deployment;
	building?: boolean;
}>();

const PREVIEW_LINES = 10;

const lines = computed(() => buildLogLines(props.containers));
const previewText = computed(() => lines.value.slice(-PREVIEW_LINES).map(line => line.segments.map(segment => segment.text).join('')));
const fullText = computed(() => lines.value.map(line => line.segments.map(segment => segment.text).join('')).join('\n'));

const expanded = ref(false);
const copied = ref(false);

const filename = computed(() => `deployment-${props.deployment.id}-build.log`.replace(/[^a-zA-Z0-9._-]/g, '-'));

async function copy(): Promise<void> {
	if (!navigator.clipboard) return;
	await navigator.clipboard.writeText(fullText.value);
	copied.value = true;
	window.setTimeout(() => {
		copied.value = false;
	}, 1200);
}

function download(): void {
	const blob = new Blob([fullText.value], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename.value;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
</script>

<template>
	<div v-if="!expanded" class="flex flex-col gap-1">
		<div v-if="building && previewText.length" class="flex flex-col gap-0.5">
			<span v-for="(text, index) in previewText" :key="index" class="truncate font-mono text-[0.7rem] text-muted-subtle">{{ text }}</span>
		</div>
		<button
			type="button"
			class="flex items-center gap-1 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
			@click="expanded = true"
		>
			<ChevronDown class="size-3" />
			Show build log
		</button>
	</div>

	<div v-else class="overflow-hidden rounded-md border border-gray-800 bg-gray-950">
		<div class="flex items-center gap-2 border-b border-gray-800 bg-gray-900/60 px-2 py-1.5">
			<button
				type="button"
				class="flex items-center gap-1 font-mono text-xs text-gray-400 transition-colors hover:text-gray-200"
				@click="expanded = false"
			>
				<ChevronDown class="size-3 rotate-180" />
				Build log
			</button>
			<div class="ml-auto flex items-center gap-1">
				<button
					type="button"
					class="flex size-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
					aria-label="Copy build log"
					@click="copy"
				>
					<Check v-if="copied" class="size-3.5" />
					<Copy v-else class="size-3.5" />
				</button>
				<button
					type="button"
					class="flex size-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
					aria-label="Download build log"
					@click="download"
				>
					<Download class="size-3.5" />
				</button>
			</div>
		</div>
		<div class="max-h-96 overflow-x-hidden overflow-y-auto p-3 font-mono text-xs leading-5 text-gray-300">
			<template v-for="(line, index) in lines" :key="index">
				<div v-if="line.showDivider" class="mt-3 mb-1 flex items-center gap-2 text-[0.7rem] text-gray-500 first:mt-0">
					<span class="h-px flex-1 bg-gray-800" />
					{{ line.container }}
					<span class="h-px flex-1 bg-gray-800" />
				</div>
				<div class="min-h-5 whitespace-pre-wrap wrap-break-word">
					<span v-for="(segment, segmentIndex) in line.segments" :key="segmentIndex" :class="segment.classes">{{ segment.text }}</span>
				</div>
			</template>
		</div>
	</div>
</template>
