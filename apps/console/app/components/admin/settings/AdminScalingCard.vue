<script setup lang="ts">
import { Gauge, Layers } from 'lucide-vue-next';

const store = useScalingSettings();
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Gauge class="size-4 text-muted-foreground" />
				Scaling
			</CardTitle>
			<CardDescription>How the platform spreads load and how much work runs in parallel.</CardDescription>
		</CardHeader>

		<CardContent class="flex flex-col gap-5">
			<!-- High availability — a prominent capability toggle -->
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-start gap-3">
					<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Layers class="size-5" />
					</span>
					<div class="flex flex-col gap-0.5">
						<span class="text-sm font-medium">High availability</span>
						<span class="text-xs text-muted-foreground">
							Run api, console, worker and the CloudNativePG database as 3 replicas with soft anti-affinity. Constraints are soft, so smaller clusters
							still run — full spread needs at least 3 nodes.
						</span>
					</div>
				</div>
				<Switch v-model="store.draft.ha.enabled" aria-label="Enable high availability" />
			</div>

			<Separator />

			<!-- Numeric knobs, side by side -->
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<label for="max-concurrent-deployments" class="text-sm font-medium">Max concurrent deployments</label>
					<Input
						id="max-concurrent-deployments"
						v-model.number="store.draft.concurrency.maxConcurrentDeployments"
						type="number"
						:min="1"
						:max="20"
						:aria-invalid="!store.concurrencyValid"
					/>
					<span v-if="store.concurrencyValid" class="text-xs text-muted-foreground">Between 1 and 20. Extra deployments queue. Default 3.</span>
					<span v-else class="text-xs text-destructive">Enter a whole number between 1 and 20.</span>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="max-previews-per-project" class="text-sm font-medium">PR previews per project</label>
					<Input
						id="max-previews-per-project"
						v-model.number="store.draft.prPreview.maxPreviewsPerProject"
						type="number"
						:min="0"
						:max="100"
						:aria-invalid="!store.prValid"
					/>
					<span v-if="store.prValid" class="text-xs text-muted-foreground">Max simultaneous preview envs per project. 0 pauses creation.</span>
					<span v-else class="text-xs text-destructive">Enter a whole number between 0 and 100.</span>
				</div>
			</div>
		</CardContent>
	</Card>
</template>
