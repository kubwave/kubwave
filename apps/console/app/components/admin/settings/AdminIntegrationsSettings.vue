<script setup lang="ts">
// Owns the unified draft/save store for the Integrations tab and wires the consolidated save bar.
const store = provideIntegrationSettings();
</script>

<template>
	<div class="flex flex-col gap-6">
		<AdminDomainCard />
		<AdminRegistryCard />
		<AdminEmailCard />
		<AdminMetricsCard />

		<SettingsSaveBar :count="store.dirtyCount" :saving="store.isSaving" :can-save="store.canSave" @save="store.save" @discard="store.discard" />
	</div>
</template>
