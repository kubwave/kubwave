<script setup lang="ts">
import { ChartLine } from 'lucide-vue-next';

type Provider = 'live' | 'prometheus-external' | 'prometheus-managed';

const store = useIntegrationSettings();

const OPTIONS: { value: Provider; label: string; description: string }[] = [
	{ value: 'live', label: 'Live only', description: 'Current usage from the kubelet — no history kept. No extra infrastructure.' },
	{
		value: 'prometheus-external',
		label: 'External Prometheus',
		description: 'Historical charts from a Prometheus you already run. Enter its URL below.'
	},
	{ value: 'prometheus-managed', label: 'Managed Prometheus', description: 'The platform deploys and runs Prometheus for you, in-cluster.' }
];

const needsUrl = computed(() => store.draft.metrics.provider === 'prometheus-external');
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<ChartLine class="size-4 text-muted-foreground" />
				Service metrics
			</CardTitle>
			<CardDescription>Where the per-service Metrics tab gets CPU, memory, network and disk data from.</CardDescription>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<SettingRadioCards v-model="store.draft.metrics.provider" :options="OPTIONS" />

			<div v-if="needsUrl" class="flex flex-col gap-1.5">
				<label for="prometheus-url" class="text-sm font-medium">Prometheus URL</label>
				<Input
					id="prometheus-url"
					v-model="store.draft.metrics.prometheusUrl"
					placeholder="http://prometheus.monitoring.svc:9090"
					:aria-invalid="!store.metricsUrlValid"
				/>
				<p v-if="store.metricsUrlValid" class="text-xs text-muted-foreground">Base URL of the Prometheus HTTP API (no trailing path).</p>
				<p v-else class="text-xs text-destructive">Enter the Prometheus URL.</p>
			</div>
		</CardContent>
	</Card>
</template>
