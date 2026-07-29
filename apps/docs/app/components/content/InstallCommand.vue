<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next';

const installCmd = useInstallCommand();
const copied = ref(false);

async function copyCommand(): Promise<void> {
	try {
		await navigator.clipboard.writeText(installCmd.value);
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
			<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">terminal</span>
			<Button variant="ghost" size="sm" class="h-7 gap-1.5 px-2 text-xs" @click="copyCommand">
				<Check v-if="copied" class="size-3.5" />
				<Copy v-else class="size-3.5" />
				{{ copied ? 'Copied' : 'Copy' }}
			</Button>
		</div>
		<pre class="overflow-x-auto bg-muted/45 p-4 font-mono text-sm leading-6">{{ installCmd }}</pre>
	</div>
</template>
