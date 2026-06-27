<script setup lang="ts">
// Owns the unified draft/save store for the Scaling & storage tab and wires the consolidated save bar.
const store = provideScalingSettings();
</script>

<template>
	<div class="flex flex-col gap-6">
		<AdminScalingCard />
		<AdminStorageCard />

		<SettingsSaveBar :count="store.dirtyCount" :saving="store.isSaving" :can-save="store.canSave" @save="store.save" @discard="store.discard" />
	</div>
</template>
