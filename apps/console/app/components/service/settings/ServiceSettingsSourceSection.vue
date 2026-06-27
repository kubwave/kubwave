<script setup lang="ts">
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';
import { isDatabaseEngine } from '~/utils/database-engines';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
}>();
</script>

<template>
	<div class="flex flex-col gap-6">
		<ServiceSettingsSourceDockerImage v-if="service.type === 'docker-image'" :state :saving :service />

		<ServiceSettingsSourceDockerfile v-if="service.type === 'dockerfile'" :state :saving :service />

		<ServiceSettingsSourcePublicRepo v-if="service.type === 'public-repo'" :state :saving :service />

		<ServiceSettingsSourcePrivateRepo v-if="service.type === 'private-repo'" :state :saving :service />

		<ServiceSettingsSourceDatabase v-if="isDatabaseEngine(service.type)" :state :saving :service />
	</div>
</template>
