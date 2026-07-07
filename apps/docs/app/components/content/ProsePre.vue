<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next';

const props = defineProps<{
	readonly code?: string;
	readonly language?: string;
	readonly filename?: string;
}>();

const copied = ref(false);
const preElement = ref<HTMLElement | null>(null);

async function copyCode(): Promise<void> {
	const text = props.code ?? preElement.value?.innerText ?? '';
	try {
		await navigator.clipboard.writeText(text);
		copied.value = true;
		window.setTimeout(() => {
			copied.value = false;
		}, 1200);
	} catch {
		copied.value = false;
	}
}
</script>

<template>
	<div class="my-6 overflow-hidden rounded-xl border bg-card shadow-xs">
		<div class="flex items-center gap-3 border-b bg-muted/70 px-4 py-2">
			<div class="flex gap-1.5" aria-hidden="true">
				<span class="size-2.5 rounded-full bg-destructive/80" />
				<span class="size-2.5 rounded-full bg-warning/80" />
				<span class="size-2.5 rounded-full bg-success/80" />
			</div>
			<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{{ filename ?? language ?? 'terminal' }}</span>
			<Button variant="ghost" size="sm" class="h-7 gap-1.5 px-2 text-xs" @click="copyCode">
				<Check v-if="copied" class="size-3.5" />
				<Copy v-else class="size-3.5" />
				{{ copied ? 'Copied' : 'Copy' }}
			</Button>
		</div>
		<pre ref="preElement" class="overflow-x-auto bg-muted/45 p-4 font-mono text-sm leading-6"><slot /></pre>
	</div>
</template>
