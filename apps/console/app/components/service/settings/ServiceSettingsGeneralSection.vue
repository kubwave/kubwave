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
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">General</h3>
					<p class="text-xs text-muted-foreground">Name and describe this service.</p>
				</div>
			</div>
			<ServiceSettingsField name="name" label="Name">
				<Input v-model="state.name" :disabled="saving" class="w-full" />
			</ServiceSettingsField>
			<ServiceSettingsField name="description" label="Description">
				<Input v-model="state.description" :disabled="saving" class="w-full" />
			</ServiceSettingsField>
		</section>
	</div>
</template>
