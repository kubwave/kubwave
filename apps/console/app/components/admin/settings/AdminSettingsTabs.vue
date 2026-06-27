<script setup lang="ts">
import { Gauge, Plug, ServerCog } from 'lucide-vue-next';

// Pure tab bar with v-if panels below; the original sections are grouped into three themed tabs.
const tab = ref('system');
</script>

<template>
	<div class="flex flex-col gap-6">
		<Tabs v-model="tab" class="w-full">
			<TabsList>
				<TabsTrigger value="system">
					<ServerCog class="size-4" />
					System
				</TabsTrigger>
				<TabsTrigger value="scaling">
					<Gauge class="size-4" />
					Scaling & storage
				</TabsTrigger>
				<TabsTrigger value="integrations">
					<Plug class="size-4" />
					Integrations
				</TabsTrigger>
			</TabsList>
		</Tabs>

		<div v-if="tab === 'system'" class="flex flex-col gap-6">
			<AdminSystemStatus />
		</div>

		<div v-else-if="tab === 'scaling'">
			<AdminScalingStorageSettings />
		</div>

		<div v-else-if="tab === 'integrations'">
			<AdminIntegrationsSettings />
		</div>
	</div>
</template>
