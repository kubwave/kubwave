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
				<h3 class="text-sm font-medium">Dockerfile</h3>
				<p class="text-xs text-muted-foreground">The Dockerfile the platform builds, and the port the built image listens on.</p>
			</div>
		</div>
		<ServiceSettingsField name="dockerfile">
			<ClientOnly>
				<ServiceCodeEditor v-model="state.dockerfile" filename="Dockerfile" language-label="Dockerfile" :disabled="saving" />
				<template #fallback>
					<Skeleton class="h-80 w-full rounded-md" />
				</template>
			</ClientOnly>
		</ServiceSettingsField>
		<ServiceSettingsField name="containerPort" label="Container port">
			<Input v-model="state.containerPort" inputmode="numeric" placeholder="3000" class="w-full" :disabled="saving" />
		</ServiceSettingsField>
	</section>
</template>
