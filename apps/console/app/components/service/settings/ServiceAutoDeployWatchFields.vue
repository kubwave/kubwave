<script setup lang="ts">
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
}>();
</script>

<template>
	<div v-if="state.autoDeploy.enabled" class="flex flex-col gap-3">
		<p v-if="state.rootDirectory.trim() && !state.watchEntireRepo" class="text-xs text-muted-foreground">
			Auto-deploy only runs when files change under
			<span class="font-mono">{{ state.rootDirectory.trim() }}</span>
			(and any additional watch paths below).
		</p>
		<label class="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
			<div>
				<p class="text-sm font-medium">Watch entire repository</p>
				<p class="text-xs text-muted-foreground">Ignore the root directory and watch paths; deploy on any commit.</p>
			</div>
			<Switch v-model="state.watchEntireRepo" :disabled="saving" />
		</label>
		<ServiceSettingsField
			v-if="!state.watchEntireRepo"
			name="watchPaths"
			label="Additional watch paths"
			description="One repo-relative path per line (e.g. packages/shared). Changes here also trigger auto-deploy."
		>
			<Textarea
				v-model="state.watchPaths"
				placeholder="packages/shared&#10;packages/db"
				class="min-h-20 w-full font-mono text-xs"
				:disabled="saving"
			/>
		</ServiceSettingsField>
	</div>
</template>
