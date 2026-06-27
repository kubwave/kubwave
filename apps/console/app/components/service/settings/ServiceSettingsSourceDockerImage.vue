<script setup lang="ts">
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
}>();
</script>

<template>
	<section class="flex flex-col gap-3">
		<div class="flex items-start justify-between gap-2">
			<div>
				<h3 class="text-sm font-medium">Docker</h3>
				<p class="text-xs text-muted-foreground">The container image and the port it listens on.</p>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-5">
			<ServiceSettingsField name="image" label="Image" class="sm:col-span-3">
				<Input v-model="state.image" class="w-full font-mono text-xs" :disabled="saving" />
			</ServiceSettingsField>
			<ServiceSettingsField name="tag" label="Tag" class="sm:col-span-1">
				<Input v-model="state.tag" class="w-full font-mono text-xs" :disabled="saving" />
			</ServiceSettingsField>
			<ServiceSettingsField name="containerPort" label="Container port">
				<Input v-model="state.containerPort" inputmode="numeric" placeholder="3000" class="w-full" :disabled="saving" />
			</ServiceSettingsField>
		</div>
	</section>
</template>
