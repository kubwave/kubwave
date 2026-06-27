<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	addCommand: () => void;
	removeCommand: (index: number) => void;
	addArg: () => void;
	removeArg: (index: number) => void;
}>();
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Command (entrypoint override) -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Command</h3>
					<p class="text-xs text-muted-foreground">
						Overrides the image's entrypoint (Kubernetes <code>command</code>). One token per row, in order — leave empty to keep the image default.
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" :disabled="saving" @click="addCommand">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.command.length === 0" class="text-sm text-muted-foreground">Using the image's default entrypoint.</p>
			<div v-for="(item, index) in state.command" :key="item._id" class="flex items-center gap-2">
				<Input v-model="item.value" placeholder="e.g. edge-runtime" class="flex-1 font-mono text-xs" :disabled="saving" />
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0 text-muted-foreground hover:text-destructive"
					:disabled="saving"
					@click="removeCommand(index)"
				>
					<X />
				</Button>
			</div>
		</section>

		<Separator />

		<!-- Args (entrypoint arguments) -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Arguments</h3>
					<p class="text-xs text-muted-foreground">
						Arguments passed to the entrypoint (Kubernetes <code>args</code>). One token per row, in order — e.g. <code>start</code>, then
						<code>--main-service</code>, then <code>/home/deno/functions/main</code>.
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" :disabled="saving" @click="addArg">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.args.length === 0" class="text-sm text-muted-foreground">No arguments.</p>
			<div v-for="(item, index) in state.args" :key="item._id" class="flex items-center gap-2">
				<Input v-model="item.value" placeholder="argument" class="flex-1 font-mono text-xs" :disabled="saving" />
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0 text-muted-foreground hover:text-destructive"
					:disabled="saving"
					@click="removeArg(index)"
				>
					<X />
				</Button>
			</div>
		</section>
	</div>
</template>
