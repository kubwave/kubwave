<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next';

const installCmd = 'curl -fsSL https://get.kubwave.com | sh';
const copied = ref(false);

async function copyInstallCmd(): Promise<void> {
	try {
		await navigator.clipboard.writeText(installCmd);
		copied.value = true;
		setTimeout(() => {
			copied.value = false;
		}, 1600);
	} catch {
		// Clipboard not available — silently no-op
	}
}
</script>

<template>
	<div class="terminal-window w-full max-w-lg">
		<!-- Titlebar with macOS traffic lights -->
		<div class="terminal-titlebar">
			<span class="terminal-dot terminal-dot-red" />
			<span class="terminal-dot terminal-dot-yellow" />
			<span class="terminal-dot terminal-dot-green" />
			<span class="ml-2 font-mono text-xs text-white/40">Terminal</span>
		</div>
		<!-- Command body -->
		<div class="terminal-body">
			<div class="flex items-start gap-3">
				<span class="select-none text-[#5fdff0]">$</span>
				<code class="flex-1 text-[#e7e9f2]">{{ installCmd }}</code>
				<button
					class="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
					aria-label="Copy install command"
					@click="copyInstallCmd"
				>
					<Check v-if="copied" class="size-4" />
					<Copy v-else class="size-4" />
				</button>
			</div>
		</div>
	</div>
</template>
